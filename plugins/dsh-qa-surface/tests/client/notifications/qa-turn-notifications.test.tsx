// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QA_TURN_NOTICE_COPY,
  QaTurnNotice,
} from "../../../src/client/components/QaTurnNotice.js";
import { buildChatRows } from "../../../src/client/components/QaSidebar.js";
import { useQaTurnNotifications } from "../../../src/client/notifications/use-turn-notifications.js";
import type {
  QaAccountNotifications,
  QaAccountNotificationsInput,
  ResolvedQaSurfaceConfig,
} from "../../../src/types.js";

type Switches = ResolvedQaSurfaceConfig["notifications"];

const STORAGE_KEY = "dsh-qa-surface.session:v1:/qa:notifications";
const ON = { enabled: true, allowOs: true } as const;

/**
 * The host list is the whole deployment's: every account's chats arrive in it.
 * The rows the surface feeds the notices are this browser's own index
 * projected onto that list, which is what keeps another account's activity out
 * of a notice — so the projection is part of the scenario, not a fixture.
 */
function hostList(
  chats: readonly { id: string; running: boolean }[],
): SessionListState {
  return {
    ids: chats.map((chat) => chat.id) as never[],
    byId: Object.fromEntries(
      chats.map((chat) => [
        chat.id,
        {
          id: chat.id,
          displayTitle: `Чат ${chat.id}`,
          running: chat.running,
          blank: false,
          updatedAt: 1,
        },
      ]),
    ) as SessionListState["byId"],
    phase: "ready",
    projectionsBySession: {},
  };
}

interface ProbeProps {
  readonly list: SessionListState;
  readonly chatIds: readonly string[];
  readonly activeSessionId: string | null;
  readonly notifications: Switches;
  readonly paused: boolean;
  readonly onSwitch: (sessionId: string) => void;
  /** The signed-in reader's channels and the write that changes them. */
  readonly account?: {
    readonly notifications: QaAccountNotifications;
    readonly onSave: (
      input: QaAccountNotificationsInput,
    ) => Promise<string | null>;
  };
}

function Probe(props: ProbeProps) {
  const notices = useQaTurnNotifications({
    chats: buildChatRows(props.chatIds, props.list.byId, props.activeSessionId),
    notifications: props.notifications,
    storage: window.localStorage,
    storageKey: STORAGE_KEY,
    paused: props.paused,
    activeSessionId: props.activeSessionId,
    onSwitch: props.onSwitch,
    ...(props.account === undefined ? {} : { account: props.account }),
  });
  return (
    <QaTurnNotice
      items={notices.items}
      onOpen={notices.onOpen}
      onDismiss={notices.onDismiss}
      {...(notices.onEnableDesktop === undefined
        ? {}
        : { onEnableDesktop: notices.onEnableDesktop })}
    />
  );
}

class FakeNotification {
  static permission: NotificationPermission = "granted";
  /** What the reader answers the browser's prompt with, once it is asked. */
  static answer: NotificationPermission = "granted";
  static raised: string[] = [];
  static asked = 0;

  onclick: (() => void) | null = null;

  constructor(title: string) {
    FakeNotification.raised.push(title);
  }

  addEventListener(): void {}

  static async requestPermission(): Promise<NotificationPermission> {
    FakeNotification.asked += 1;
    // The reader answered the browser's prompt, one way or the other.
    FakeNotification.permission = FakeNotification.answer;
    return FakeNotification.permission;
  }
}

/**
 * One page, redrawn as the host list moves: the notices belong to the reader
 * who watched a turn run, so every frame has to reach the same instance.
 */
function mountPage(
  list: SessionListState,
  options: {
    chatIds?: readonly string[];
    activeSessionId?: string | null;
    notifications?: Switches;
    paused?: boolean;
    onSwitch?: (sessionId: string) => void;
    account?: ProbeProps["account"];
  } = {},
) {
  const props = {
    list,
    chatIds: options.chatIds ?? ["mine"],
    activeSessionId: options.activeSessionId ?? null,
    notifications: options.notifications ?? { ...ON },
    paused: options.paused ?? false,
    onSwitch: options.onSwitch ?? vi.fn(),
    ...(options.account === undefined ? {} : { account: options.account }),
  };
  const view = render(<Probe {...props} />);
  return {
    view,
    onSwitch: props.onSwitch,
    redraw(
      next: Partial<Omit<ProbeProps, "chatIds">> & {
        chatIds?: readonly string[];
      },
    ) {
      view.rerender(<Probe {...props} {...next} />);
    },
  };
}

function storedPrefs(): unknown {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  document.hasFocus = () => true;
  window.localStorage.clear();
  FakeNotification.permission = "granted";
  FakeNotification.answer = "granted";
  FakeNotification.raised = [];
  FakeNotification.asked = 0;
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("turn completion notices", () => {
  it("reports the owner's own chat and never the other account's", () => {
    const page = mountPage(
      hostList([
        { id: "mine", running: true },
        { id: "theirs", running: true },
      ]),
    );
    expect(screen.queryByText("Чат mine")).toBeNull();

    // Both turns end in the same frame; only this browser's chat is on screen.
    page.redraw({
      list: hostList([
        { id: "mine", running: false },
        { id: "theirs", running: false },
      ]),
    });
    expect(screen.getByText("Чат mine")).toBeTruthy();
    expect(screen.queryByText("Чат theirs")).toBeNull();
  });

  it("stays silent about a turn it never saw run", () => {
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.queryByText("Чат mine")).toBeNull();
  });

  it("says nothing while the browser is reconnecting", () => {
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({
      list: hostList([{ id: "mine", running: false }]),
      paused: true,
    });
    expect(screen.queryByText("Чат mine")).toBeNull();
    // The link is back: the stale frames are not reported after the fact.
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.queryByText("Чат mine")).toBeNull();
  });

  it("raises nothing on a stand that switched the channel off", () => {
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({
      list: hostList([{ id: "mine", running: false }]),
      notifications: { enabled: false, allowOs: false },
    });
    expect(screen.queryByText("Чат mine")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);
  });

  it("keeps the notice inside the page while the reader is looking", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ osEnabled: true, osOffered: true }),
    );
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(FakeNotification.raised).toEqual([]);
    expect(screen.getByText("Чат mine")).toBeTruthy();
  });

  it("hands a finished turn to the desktop once the page is away", () => {
    document.hasFocus = () => false;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ osEnabled: true, osOffered: true }),
    );
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(FakeNotification.raised).toEqual(["Чат mine"]);
  });

  it("opens the chat and retires its line", () => {
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    fireEvent.click(screen.getByText("Чат mine"));
    expect(page.onSwitch).toHaveBeenCalledWith("mine");
    expect(screen.queryByText("Чат mine")).toBeNull();
  });

  it("asks for the desktop channel once and remembers the answer", async () => {
    FakeNotification.permission = "default";
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    const offer = screen.getByRole("button", {
      name: QA_TURN_NOTICE_COPY.offerAction,
    });
    fireEvent.click(offer);
    // The browser answers the permission prompt on its own schedule.
    await waitFor(() =>
      expect(storedPrefs()).toEqual({ osEnabled: true, osOffered: true }),
    );

    // The question is gone, and a later turn does not bring it back.
    page.redraw({
      list: hostList([
        { id: "mine", running: false },
        { id: "second", running: true },
      ]),
      chatIds: ["mine", "second"],
    });
    page.redraw({
      list: hostList([
        { id: "mine", running: false },
        { id: "second", running: false },
      ]),
      chatIds: ["mine", "second"],
    });
    expect(screen.getByText("Чат second")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: QA_TURN_NOTICE_COPY.offerAction,
      }),
    ).toBeNull();
    expect(FakeNotification.asked).toBe(1);
  });

  it("writes a refused prompt as a channel that stayed off", async () => {
    // The other half of the click: what the browser answers is what the record
    // keeps, and the spent prompt is what stops the page asking a second time.
    FakeNotification.permission = "default";
    FakeNotification.answer = "denied";
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    fireEvent.click(
      screen.getByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    );
    await waitFor(() =>
      expect(storedPrefs()).toEqual({ osEnabled: false, osOffered: true }),
    );
    expect(FakeNotification.asked).toBe(1);

    document.hasFocus = () => false;
    settleSecondChat(
      page,
      hostList([
        { id: "mine", running: false },
        { id: "second", running: true },
      ]),
    );
    expect(screen.getByText("Чат second")).toBeTruthy();
    expect(FakeNotification.raised).toEqual([]);
    expect(
      screen.queryByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeNull();
  });

  it("waves the offer off with the line it sits under", () => {
    FakeNotification.permission = "default";
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    fireEvent.click(
      screen.getByLabelText(`${QA_TURN_NOTICE_COPY.dismiss}: Чат mine`),
    );
    expect(storedPrefs()).toEqual({ osEnabled: false, osOffered: true });
  });

  /**
   * The frames that settle a second chat, so a channel switched on mid-scenario
   * is measured on a turn that ended after the switch and not on one already
   * reported.
   */
  function settleSecondChat(
    page: ReturnType<typeof mountPage>,
    list: SessionListState,
  ): void {
    page.redraw({ list, chatIds: ["mine", "second"] });
    page.redraw({
      list: hostList([
        { id: "mine", running: false },
        { id: "second", running: false },
      ]),
      chatIds: ["mine", "second"],
    });
  }

  it("lets a browser that already allowed the prompt switch the channel on", async () => {
    // Permission granted from elsewhere and nothing stored here: the browser has
    // no question left to ask, so the page's own action is the only way in.
    FakeNotification.permission = "granted";
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    fireEvent.click(
      screen.getByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    );
    // The choice is stored on its own: a click that asked the browser nothing
    // spends no prompt.
    await waitFor(() =>
      expect(storedPrefs()).toEqual({ osEnabled: true, osOffered: false }),
    );
    // The click settled the channel without spending the browser's prompt.
    expect(FakeNotification.asked).toBe(0);

    document.hasFocus = () => false;
    settleSecondChat(
      page,
      hostList([
        { id: "mine", running: false },
        { id: "second", running: true },
      ]),
    );
    expect(FakeNotification.raised).toEqual(["Чат second"]);
    expect(
      screen.queryByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeNull();
  });

  it("keeps the cross a way of clearing the stack, not of refusing the channel", () => {
    // On a stand without accounts this action is the channel's only way in, and
    // waving one line off says nothing about it: the switch comes back with the
    // next line rather than leaving the reader stuck behind localStorage.
    FakeNotification.permission = "granted";
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    fireEvent.click(
      screen.getByLabelText(`${QA_TURN_NOTICE_COPY.dismiss}: Чат mine`),
    );
    expect(storedPrefs()).toBeNull();

    settleSecondChat(
      page,
      hostList([
        { id: "mine", running: false },
        { id: "second", running: true },
      ]),
    );
    expect(screen.getByText("Чат second")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeTruthy();
  });

  it("leaves a permission the reader took back to the address bar", async () => {
    // The channel was switched on here, then the permission was revoked in the
    // address bar. The reader's own answer is still on, so this page offers
    // nothing: what went missing is the browser's answer, and that one is given
    // in the address bar. Allowing the origin again delivers the next turn
    // without this page touching the record — which is what makes the state a
    // pause rather than a dead end.
    FakeNotification.permission = "granted";
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    fireEvent.click(
      screen.getByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    );
    await waitFor(() =>
      expect(storedPrefs()).toEqual({ osEnabled: true, osOffered: false }),
    );

    FakeNotification.permission = "default";
    document.hasFocus = () => false;
    settleSecondChat(
      page,
      hostList([
        { id: "mine", running: false },
        { id: "second", running: true },
      ]),
    );
    expect(screen.getByText("Чат second")).toBeTruthy();
    expect(FakeNotification.raised).toEqual([]);
    expect(
      screen.queryByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeNull();
    expect(FakeNotification.asked).toBe(0);

    // Allowed again in the address bar: the record was never the missing half.
    FakeNotification.permission = "granted";
    page.redraw({
      list: hostList([
        { id: "mine", running: false },
        { id: "second", running: false },
        { id: "third", running: true },
      ]),
      chatIds: ["mine", "second", "third"],
    });
    page.redraw({
      list: hostList([
        { id: "mine", running: false },
        { id: "second", running: false },
        { id: "third", running: false },
      ]),
      chatIds: ["mine", "second", "third"],
    });
    expect(FakeNotification.raised).toEqual(["Чат third"]);
  });

  it("offers no question where the record already says the channel is on", () => {
    // The same answer of the reader's, reached without any clicking: it closes
    // the offer in the branch that still owes the browser an answer too. What
    // this state cannot deliver is the permission, and re-asking for it under a
    // choice the reader already made is not the line's business.
    FakeNotification.permission = "default";
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ osEnabled: true, osOffered: false }),
    );
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.getByText("Чат mine")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeNull();
    expect(FakeNotification.asked).toBe(0);
  });

  it("offers no switch the reader has already thrown", () => {
    // The channel being on is the reader's own answer: the action is for the one
    // still missing, and it is not a fixture the stack carries around.
    FakeNotification.permission = "granted";
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ osEnabled: true, osOffered: false }),
    );
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.getByText("Чат mine")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeNull();
  });

  it("offers no switch the stand itself has closed", () => {
    // `allowOs` leaves the in-page line and takes the desktop with it: a granted
    // browser is not an answer that overrides what the deployment switched off.
    FakeNotification.permission = "granted";
    const page = mountPage(hostList([{ id: "mine", running: true }]), {
      notifications: { enabled: true, allowOs: false },
    });
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.getByText("Чат mine")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeNull();
  });

  it("offers no switch a refused browser cannot honour", () => {
    FakeNotification.permission = "denied";
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.getByText("Чат mine")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeNull();
  });

  it("offers no switch a page without the desktop API cannot honour", () => {
    // Off a non-secure context there is no Notification to ask or to obey.
    vi.stubGlobal("Notification", undefined);
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.getByText("Чат mine")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeNull();
  });
});

describe("the account's own channels", () => {
  /** One signed-in reader: the account's record and the write behind the form. */
  function signedIn(
    notifications: QaAccountNotifications,
    onSave = vi.fn(async (_input: QaAccountNotificationsInput) => null),
  ): { options: { account: ProbeProps["account"] }; onSave: typeof onSave } {
    return { options: { account: { notifications, onSave } }, onSave };
  }

  it("follows the account and ignores what this browser once stored", () => {
    // A browser that raised desktop notices for its previous reader must not
    // decide anything about the account now signed in.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ osEnabled: true, osOffered: true }),
    );
    document.hasFocus = () => false;
    const { options } = signedIn({ inApp: true, desktop: false });
    const page = mountPage(hostList([{ id: "mine", running: true }]), options);
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(FakeNotification.raised).toEqual([]);
    expect(screen.getByText("Чат mine")).toBeTruthy();
  });

  it("raises the desktop notice because the account asked for it", () => {
    document.hasFocus = () => false;
    const { options } = signedIn({ inApp: true, desktop: true });
    const page = mountPage(hostList([{ id: "mine", running: true }]), options);
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(FakeNotification.raised).toEqual(["Чат mine"]);
  });

  it("keeps the page line off when the reader switched it off", () => {
    const { options } = signedIn({ inApp: false, desktop: false });
    const page = mountPage(hostList([{ id: "mine", running: true }]), options);
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.queryByText("Чат mine")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);
  });

  it("answers the desktop offer on the account, not on this browser", async () => {
    FakeNotification.permission = "default";
    const { options, onSave } = signedIn({ inApp: true, desktop: false });
    const page = mountPage(hostList([{ id: "mine", running: true }]), options);
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    fireEvent.click(
      screen.getByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    );
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ inApp: true, desktop: true }),
    );
    // The browser still remembers it asked, which is a fact about this
    // browser's prompt rather than about the person.
    expect(storedPrefs()).toEqual({ osEnabled: true, osOffered: true });
  });

  it("leaves a granted channel of a signed-in reader to their own settings", () => {
    // The browser has answered for this origin already, and with an account the
    // channel itself is decided in the «Уведомления» section: the notice asks
    // for nothing there and writes nothing on its own.
    FakeNotification.permission = "granted";
    const { options, onSave } = signedIn({ inApp: true, desktop: false });
    const page = mountPage(hostList([{ id: "mine", running: true }]), options);
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.getByText("Чат mine")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });
});
