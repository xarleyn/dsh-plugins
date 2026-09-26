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
  static raised: string[] = [];
  static asked = 0;

  onclick: (() => void) | null = null;

  constructor(title: string) {
    FakeNotification.raised.push(title);
  }

  addEventListener(): void {}

  static async requestPermission(): Promise<NotificationPermission> {
    FakeNotification.asked += 1;
    // The reader answered the browser's prompt by allowing this origin.
    FakeNotification.permission = "granted";
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

  it("waves the offer off with the line it sits under", () => {
    FakeNotification.permission = "default";
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    fireEvent.click(
      screen.getByLabelText(`${QA_TURN_NOTICE_COPY.dismiss}: Чат mine`),
    );
    expect(storedPrefs()).toEqual({ osEnabled: false, osOffered: true });
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
});
