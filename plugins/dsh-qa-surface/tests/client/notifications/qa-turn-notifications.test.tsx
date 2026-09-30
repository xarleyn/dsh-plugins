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

type RedrawProps = Partial<Omit<ProbeProps, "chatIds">> & {
  chatIds?: readonly string[];
};

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
  /**
   * Set to a promise to keep the prompt open until the scenario answers it by
   * hand: the browser decides on its own schedule, and the page keeps rendering
   * while it waits.
   */
  static heldPrompt: Promise<NotificationPermission> | null = null;
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
    FakeNotification.permission =
      (await FakeNotification.heldPrompt) ?? FakeNotification.answer;
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
  const redraw = (next: RedrawProps) => {
    view.rerender(<Probe {...props} {...next} />);
  };
  return {
    view,
    onSwitch: props.onSwitch,
    redraw,
    /**
     * Watch a turn through to its end: the page sees each named chat start, and
     * then sees it stop. A notice is raised only for a run the reader watched
     * begin, so a scenario that wants one is drawn from an idle chat; what the
     * page merely found running is the cold start, and that is its own story.
     */
    watchTurn(
      ids: readonly string[] = ["mine"],
      during: RedrawProps = {},
      end: RedrawProps = {},
    ) {
      redraw({
        ...during,
        list: hostList(ids.map((id) => ({ id, running: true }))),
      });
      redraw({
        ...during,
        ...end,
        list: hostList(ids.map((id) => ({ id, running: false }))),
      });
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
  FakeNotification.heldPrompt = null;
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
        { id: "mine", running: false },
        { id: "theirs", running: true },
      ]),
    );
    expect(screen.queryByText("Чат mine")).toBeNull();

    // Both turns end in the same frame; only this browser's chat is on screen,
    // so only that one is watched from its start and only that one is reported.
    page.redraw({
      list: hostList([
        { id: "mine", running: true },
        { id: "theirs", running: true },
      ]),
    });
    page.redraw({
      list: hostList([
        { id: "mine", running: false },
        { id: "theirs", running: false },
      ]),
    });
    expect(screen.getByText("Чат mine")).toBeTruthy();
    expect(screen.queryByText("Чат theirs")).toBeNull();
  });

  it("says nothing about a turn that was already running when the page opened", () => {
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    // The reader joined a conversation already under way. Its end is not
    // something they were waiting for, and it is not reported — not now, and
    // not once the page has had a turn of its own to watch.
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.queryByText("Чат mine")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);

    page.watchTurn();
    expect(screen.getByText("Чат mine")).toBeTruthy();
  });

  it("stays silent about a turn it never saw run", () => {
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.queryByText("Чат mine")).toBeNull();
  });

  it("says nothing while the browser is reconnecting", () => {
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    page.redraw({ list: hostList([{ id: "mine", running: true }]) });
    // The turn ends while the link is down, and the frames that follow carry a
    // list this page cannot vouch for.
    page.redraw({
      list: hostList([{ id: "mine", running: false }]),
      paused: true,
    });
    expect(screen.queryByText("Чат mine")).toBeNull();
    // The link is back: the stale frames are not reported after the fact.
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.queryByText("Чат mine")).toBeNull();
  });

  it("does not arm a baseline from the idle a gap left behind", () => {
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    // The link comes back before the host list does — the page is told about the
    // connection, not about the rows — so the first live frames still carry the
    // list the drop left. An idle read through the gap is not a start the reader
    // watched, and the turn that follows it is not news.
    page.redraw({
      list: hostList([{ id: "mine", running: false }]),
      paused: true,
    });
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    page.redraw({ list: hostList([{ id: "mine", running: true }]) });
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.queryByText("Чат mine")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);
    // The row has moved twice since, so the page holds a baseline again, and the
    // next turn beginning under a live link is reported.
    page.watchTurn();
    expect(screen.getByText("Чат mine")).toBeTruthy();
  });

  it("loses the turn a reconnect found still running", () => {
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    page.redraw({ list: hostList([{ id: "mine", running: true }]) });
    // The chat is still running on both sides of the gap, but the page cannot
    // tell that run from one that started and ended inside it.
    page.redraw({
      list: hostList([{ id: "mine", running: true }]),
      paused: true,
    });
    page.redraw({ list: hostList([{ id: "mine", running: true }]) });
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.queryByText("Чат mine")).toBeNull();
  });

  it("loses the reader's own turn that starts on a recovered link", () => {
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    // The question was queued before the drop and goes out as the link returns:
    // the chat is idle in the stale frame and running in the first live one, so
    // the page never saw where that run began. Its end is reported as silently
    // as any other run it cannot vouch for (#479).
    page.redraw({
      list: hostList([{ id: "mine", running: false }]),
      paused: true,
    });
    page.redraw({ list: hostList([{ id: "mine", running: true }]) });
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.queryByText("Чат mine")).toBeNull();
    // While the link holds, the page is watching again.
    page.watchTurn();
    expect(screen.getByText("Чат mine")).toBeTruthy();
  });

  // The two edges a reconnect hands the page — the link back, and the Host's
  // refreshed list over it — come from two stores and reach a redraw in no
  // guaranteed order. In the frame between them the sidebar still shows the rows
  // the page held while the link was down, and a turn that ended offline looks
  // exactly like one that ended here. Both orders are set by hand, and both hold
  // the runs watched before the gap — cold chats would pass for the cold start
  // alone and say nothing about the stale frame (#479).
  it("keeps a list that refreshed after the link returned off the stack", () => {
    const held = hostList([
      { id: "mine", running: true },
      { id: "second", running: true },
    ]);
    const both = { chatIds: ["mine", "second"] };
    const page = mountPage(
      hostList([
        { id: "mine", running: false },
        { id: "second", running: false },
      ]),
      both,
    );
    // Both runs are seen beginning while the link holds.
    page.redraw({ ...both, list: held });
    // Both turns end offline, and the link comes back before the Host answers:
    // the first live frames carry the held list itself.
    page.redraw({ ...both, list: held, paused: true });
    page.redraw({ ...both, list: held, paused: false });
    page.redraw({ ...both, list: held });
    expect(screen.queryByText("Чат mine")).toBeNull();
    // The refreshed list lands, and the two turns that ended while nobody could
    // see them arrive as nothing.
    page.redraw({
      ...both,
      list: hostList([
        { id: "mine", running: false },
        { id: "second", running: false },
      ]),
    });
    expect(screen.queryByText("Чат mine")).toBeNull();
    expect(screen.queryByText("Чат second")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);

    // The next turn this page watches from its start raises one line, once.
    page.redraw({
      ...both,
      list: hostList([
        { id: "mine", running: true },
        { id: "second", running: false },
      ]),
    });
    page.redraw({
      ...both,
      list: hostList([
        { id: "mine", running: false },
        { id: "second", running: false },
      ]),
    });
    expect(screen.getAllByText("Чат mine")).toHaveLength(1);
    expect(screen.queryByText("Чат second")).toBeNull();
  });

  it("keeps a late refresh of several unseen endings off the stack", () => {
    const both = { chatIds: ["mine", "second"] };
    const idle = hostList([
      { id: "mine", running: false },
      { id: "second", running: false },
    ]);
    const running = hostList([
      { id: "mine", running: true },
      { id: "second", running: true },
    ]);
    const page = mountPage(idle, both);
    // Both chats sit idle under a link the page vouches for, then the link goes.
    // Either of them may have run and finished inside the gap, and its row reads
    // idle either way — the ending the card names, which must not arrive as a
    // stack of notices.
    page.redraw({ ...both, list: idle, paused: true });
    // The link comes back first and the Host's answer follows it, saying idle
    // again. Two unseen turns settle into nothing.
    page.redraw({ ...both, list: idle });
    page.redraw({ ...both, list: idle });
    expect(screen.queryByText("Чат mine")).toBeNull();
    expect(screen.queryByText("Чат second")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);
    // A turn that starts under the restored link is still one the page did not
    // see begin, and its end is silent with the others.
    page.redraw({ ...both, list: running });
    page.redraw({ ...both, list: idle });
    expect(screen.queryByText("Чат mine")).toBeNull();
    expect(screen.queryByText("Чат second")).toBeNull();
    // That is the whole of what the gap costs: one turn per chat. The rows moved
    // over a link the page vouches for, so the next turn beginning is watched
    // from its start and raises one line, for that chat alone.
    page.redraw({
      ...both,
      list: hostList([
        { id: "mine", running: true },
        { id: "second", running: false },
      ]),
    });
    page.redraw({ ...both, list: idle });
    expect(screen.getAllByText("Чат mine")).toHaveLength(1);
    expect(screen.queryByText("Чат second")).toBeNull();
  });

  it("waits for the restored link's own list when the refresh landed first", () => {
    const idle = hostList([{ id: "mine", running: false }]);
    const running = hostList([{ id: "mine", running: true }]);
    const page = mountPage(idle);
    page.redraw({ list: running });
    // The Host's answer arrives while the page is still reconnecting, and the
    // link-ready edge comes after it: that list is one the new link never
    // delivered, so it neither settles the turn it appears to have finished nor
    // leaves an idle a following run could be credited as starting from.
    page.redraw({ list: idle, paused: true });
    expect(screen.queryByText("Чат mine")).toBeNull();
    // The link is back and the row has not moved since, so this live frame still
    // says what the gap left it saying.
    page.redraw({ list: idle });
    expect(screen.queryByText("Чат mine")).toBeNull();
    // The run the next frame shows under way is still the one the gap took.
    page.redraw({ list: running });
    page.redraw({ list: idle });
    expect(screen.queryByText("Чат mine")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);

    // From here the page watches this generation's turns, and reports one.
    page.watchTurn();
    expect(screen.getAllByText("Чат mine")).toHaveLength(1);
  });

  it("bounds the silence left by a gap whose list never moved to one turn", () => {
    const idle = hostList([{ id: "mine", running: false }]);
    const page = mountPage(idle);
    page.redraw({ list: idle, paused: true });
    page.redraw({ list: idle });
    // Nothing in what the page reads announces a new list: a rule that adopted a
    // generation by telling its list apart from the one held before would wait
    // for that difference forever and never report a turn again. So the hold ends
    // on the row moving, and what it costs is the turn that moves it.
    page.watchTurn();
    expect(screen.queryByText("Чат mine")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);
    // The next turn is seen beginning from the reading that row left behind, and
    // raises one line, once.
    page.watchTurn();
    expect(screen.getAllByText("Чат mine")).toHaveLength(1);
  });

  it("raises nothing on a stand that switched the channel off", () => {
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    page.watchTurn(
      ["mine"],
      {},
      { notifications: { enabled: false, allowOs: false } },
    );
    expect(screen.queryByText("Чат mine")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);
  });

  it("keeps the notice inside the page while the reader is looking", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ osEnabled: true, osOffered: true }),
    );
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    page.watchTurn();
    expect(FakeNotification.raised).toEqual([]);
    expect(screen.getByText("Чат mine")).toBeTruthy();
  });

  it("hands a finished turn to the desktop once the page is away", () => {
    document.hasFocus = () => false;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ osEnabled: true, osOffered: true }),
    );
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    page.watchTurn();
    expect(FakeNotification.raised).toEqual(["Чат mine"]);
  });

  it("opens the chat and retires its line", () => {
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    page.watchTurn();
    fireEvent.click(screen.getByText("Чат mine"));
    expect(page.onSwitch).toHaveBeenCalledWith("mine");
    expect(screen.queryByText("Чат mine")).toBeNull();
  });

  it("asks for the desktop channel once and remembers the answer", async () => {
    FakeNotification.permission = "default";
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    page.watchTurn();
    const offer = screen.getByRole("button", {
      name: QA_TURN_NOTICE_COPY.offerAction,
    });
    fireEvent.click(offer);
    // The browser answers the permission prompt on its own schedule.
    await waitFor(() =>
      expect(storedPrefs()).toEqual({ osEnabled: true, osOffered: true }),
    );

    // The question is gone, and a later turn does not bring it back. The second
    // chat joins the sidebar idle, so its turn is one this page watches.
    const both = { chatIds: ["mine", "second"] };
    page.redraw({
      ...both,
      list: hostList([
        { id: "mine", running: false },
        { id: "second", running: false },
      ]),
    });
    page.watchTurn(["second"], both, both);
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
    const page = mountPage(hostList([{ id: "mine", running: false }]));
    page.watchTurn();
    fireEvent.click(
      screen.getByLabelText(`${QA_TURN_NOTICE_COPY.dismiss}: Чат mine`),
    );
    expect(storedPrefs()).toEqual({ osEnabled: false, osOffered: true });

    // And the mark holds: the next line does not re-ask a question this page has
    // already asked once. On a stand without accounts the way in then lives in
    // the browser's own settings, until the origin is allowed there.
    settleSecondChat(
      page,
      hostList([
        { id: "mine", running: false },
        { id: "second", running: true },
      ]),
    );
    expect(screen.getByText("Чат second")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeNull();
    expect(FakeNotification.asked).toBe(0);
  });

  it("keeps one record out of a cross and a prompt answer that overlap", async () => {
    // The browser answers on its own schedule and the page keeps rendering while
    // it waits: a reader who waves the line off before the prompt has answered
    // gets one settled record out of the two answers, rather than the last
    // answer erasing the first. What this holds is the gate, not the merge: the
    // click here spends a prompt, so `askedTheBrowser` is true and merging onto
    // the render snapshot would settle `osOffered` either way. The merge itself is
    // caught by «settles a cross and an answer that asked nothing into one
    // record» in qa-turn-notification-offer.test.tsx, where the prompt is not held.
    FakeNotification.permission = "default";
    let answerThePrompt!: (answer: NotificationPermission) => void;
    FakeNotification.heldPrompt = new Promise((resolve) => {
      answerThePrompt = resolve;
    });
    const page = mountPage(hostList([{ id: "mine", running: true }]));
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    fireEvent.click(
      screen.getByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    );
    fireEvent.click(
      screen.getByLabelText(`${QA_TURN_NOTICE_COPY.dismiss}: Чат mine`),
    );
    expect(storedPrefs()).toEqual({ osEnabled: false, osOffered: true });
    expect(FakeNotification.asked).toBe(1);

    answerThePrompt("granted");
    await waitFor(() =>
      expect(storedPrefs()).toEqual({ osEnabled: true, osOffered: true }),
    );
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
    const page = mountPage(hostList([{ id: "mine", running: false }]), options);
    page.watchTurn();
    expect(FakeNotification.raised).toEqual([]);
    expect(screen.getByText("Чат mine")).toBeTruthy();
  });

  it("raises the desktop notice because the account asked for it", () => {
    document.hasFocus = () => false;
    const { options } = signedIn({ inApp: true, desktop: true });
    const page = mountPage(hostList([{ id: "mine", running: false }]), options);
    page.watchTurn();
    expect(FakeNotification.raised).toEqual(["Чат mine"]);
  });

  it("keeps the page line off when the reader switched it off", () => {
    const { options } = signedIn({ inApp: false, desktop: false });
    const page = mountPage(hostList([{ id: "mine", running: false }]), options);
    page.watchTurn();
    expect(screen.queryByText("Чат mine")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);
  });

  it("answers the desktop offer on the account, not on this browser", async () => {
    FakeNotification.permission = "default";
    const { options, onSave } = signedIn({ inApp: true, desktop: false });
    const page = mountPage(hostList([{ id: "mine", running: false }]), options);
    page.watchTurn();
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

  it("offers no switch where the account says on and this browser says off", () => {
    // The two carriers of the reader's answer, deliberately disagreeing: the
    // account says the channel is on and this browser's own record is the one
    // that says off. The gate reads the channel, not this browser's copy of it,
    // and that is the whole of the difference — keyed on the stored `osEnabled`
    // instead, this page would offer «Включить системные уведомления» over a
    // channel that is on, and the answer «не разрешать» by it would write
    // `desktop: false` back to an account that already said yes. What the fresh
    // browser is missing is its own permission, and the settings section is
    // where that is asked.
    FakeNotification.permission = "default";
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ osEnabled: false, osOffered: false }),
    );
    const { options, onSave } = signedIn({ inApp: true, desktop: true });
    const page = mountPage(hostList([{ id: "mine", running: true }]), options);
    page.redraw({ list: hostList([{ id: "mine", running: false }]) });
    expect(screen.getByText("Чат mine")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    ).toBeNull();

    // A page with no question left to ask marks nothing for itself either.
    fireEvent.click(
      screen.getByLabelText(`${QA_TURN_NOTICE_COPY.dismiss}: Чат mine`),
    );
    expect(storedPrefs()).toEqual({ osEnabled: false, osOffered: false });
    expect(onSave).not.toHaveBeenCalled();
  });
});
