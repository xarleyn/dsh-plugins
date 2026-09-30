// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import { useMemo, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QA_TURN_NOTICE_COPY,
  QaTurnNotice,
} from "../../../src/client/components/QaTurnNotice.js";
import { buildChatRows } from "../../../src/client/components/QaSidebar.js";
import type { QaAccountsController } from "../../../src/client/QaAccountsController.js";
import { QA_TURN_NOTICE_BODY } from "../../../src/client/notifications/notification-dispatcher.js";
import { useQaTurnNotifications } from "../../../src/client/notifications/use-turn-notifications.js";
import {
  controller,
  remote,
  session,
} from "../../accounts/accounts-controller.helpers.js";
import type { QaOwnershipEntry } from "../../../src/types.js";

const OWN = "s-own";
const FOREIGN = "s-other";
const STORAGE_KEY = "dsh-qa-surface.session:v1:/qa:notifications";
const ON = { enabled: true, allowOs: true } as const;

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

/**
 * Both chats are on the Host and one of them is not yours. A notice is raised
 * only for a run this page watched begin, so a scenario that wants one opens on
 * the idle frame and settles back into it; the frames below are those three.
 */
const IDLE = hostList([
  { id: OWN, running: false },
  { id: FOREIGN, running: false },
]);
const RUNNING = hostList([
  { id: OWN, running: true },
  { id: FOREIGN, running: true },
]);

/** One own chat running while the shared chat has already settled. */
const OWN_STILL_RUNNING = hostList([
  { id: OWN, running: true },
  { id: FOREIGN, running: false },
]);

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static raised: { title: string; options: NotificationOptions }[] = [];

  onclick: (() => void) | null = null;

  constructor(title: string, options?: NotificationOptions) {
    FakeNotification.raised.push({ title, options: options ?? {} });
  }

  addEventListener(): void {}

  static async requestPermission(): Promise<NotificationPermission> {
    FakeNotification.permission = "granted";
    return FakeNotification.permission;
  }

  /** Everything the desktop channel was handed, as one searchable string. */
  static payload(): string {
    return FakeNotification.raised
      .map((notice) => `${notice.title} ${JSON.stringify(notice.options)}`)
      .join("\n");
  }
}

/**
 * The signed-in admin of a stand with the shared history on: their own chat,
 * one chat they may only read, and the account record that chooses the channels.
 * `owned` is the list the Host answers with, read on every call, so a scenario
 * can take a chat away from the account while the ownership map still names it.
 */
async function signedInAdmin(
  options: {
    desktop?: boolean;
    showOtherUsersChats?: boolean;
    owned?: string[];
  } = {},
): Promise<QaAccountsController> {
  const owned = options.owned ?? [OWN];
  const entries: readonly QaOwnershipEntry[] = [
    {
      sessionId: OWN,
      userId: "u-1",
      displayName: "Хозяин",
      claimedAt: "2026-09-11T00:00:00.000Z",
    },
    {
      sessionId: FOREIGN,
      userId: "u-2",
      displayName: "Борис",
      claimedAt: "2026-09-11T00:01:00.000Z",
    },
  ];
  const signedIn = session("t-login").value;
  const api = remote({
    accountsOwnedSessions: vi.fn(async () => ({
      ok: true as const,
      value: { ids: [...owned] },
    })),
    accountsListOwnership: vi.fn(async () => ({
      ok: true as const,
      value: { entries },
    })),
    accountsLogin: vi.fn(async () => ({
      ok: true as const,
      value: {
        ...signedIn,
        user: {
          ...signedIn.user,
          notifications: { inApp: true, desktop: options.desktop ?? false },
        },
      },
    })),
  });
  const accounts = controller(api, {
    showOtherUsersChats: options.showOtherUsersChats ?? true,
  });
  await accounts.start();
  await accounts.login("a@b.co", "password-1");
  return accounts;
}

/**
 * The page as the surface builds it: the sidebar's rows come from the account's
 * list, which an admin's shared read makes wider than ownership, and the notice
 * is bounded by the account's own chats rather than by that list.
 */
function Probe(props: {
  readonly accounts: QaAccountsController;
  readonly list: SessionListState;
}) {
  const snapshot = useSyncExternalStore(
    props.accounts.subscribe,
    props.accounts.getSnapshot,
    props.accounts.getSnapshot,
  );
  const authed = snapshot.stage === "authed" ? snapshot : null;
  const account = useMemo(
    () =>
      authed === null
        ? undefined
        : {
            notifications: authed.user.notifications,
            onSave: async () => null,
          },
    [authed],
  );
  const notices = useQaTurnNotifications({
    chats: buildChatRows(authed?.ownedIds ?? [], props.list.byId, null),
    ownChatIds: authed?.ownIds,
    notifications: ON,
    storage: window.localStorage,
    storageKey: STORAGE_KEY,
    ...(account === undefined ? {} : { account }),
    paused: false,
    activeSessionId: null,
    onSwitch: () => undefined,
  });
  return (
    <QaTurnNotice
      items={notices.items}
      onOpen={notices.onOpen}
      onDismiss={notices.onDismiss}
    />
  );
}

function mountPage(accounts: QaAccountsController, list: SessionListState) {
  const view = render(<Probe accounts={accounts} list={list} />);
  return {
    redraw(next: SessionListState) {
      view.rerender(<Probe accounts={accounts} list={next} />);
    },
    /** Both chats run to completion under the eyes of this page. */
    watchBothTurns() {
      view.rerender(<Probe accounts={accounts} list={RUNNING} />);
      view.rerender(<Probe accounts={accounts} list={IDLE} />);
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  document.hasFocus = () => true;
  window.localStorage.clear();
  FakeNotification.permission = "granted";
  FakeNotification.raised = [];
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a notice speaks for the owner's chats only", () => {
  it("keeps the shared chat out of the stack the admin's own turn fills", async () => {
    const accounts = await signedInAdmin();
    // The read scope stays wide: the shared chat is on the screen all the same.
    expect(accounts.ownedIds()).toEqual([OWN, FOREIGN]);
    const page = mountPage(accounts, IDLE);
    page.watchBothTurns();

    expect(screen.getAllByTestId("qa-turn-notice-item")).toHaveLength(1);
    expect(screen.getByText(`Чат ${OWN}`)).toBeTruthy();
    expect(screen.getByText(QA_TURN_NOTICE_COPY.finished)).toBeTruthy();
    expect(screen.queryByText(`Чат ${FOREIGN}`)).toBeNull();
  });

  it("hands the desktop its own chat alone, with no transcript and no identity", async () => {
    document.hasFocus = () => false;
    const accounts = await signedInAdmin({ desktop: true });
    const page = mountPage(accounts, IDLE);
    page.watchBothTurns();

    expect(FakeNotification.raised.map((notice) => notice.title)).toEqual([
      `Чат ${OWN}`,
    ]);
    // The two fields the desktop channel is handed, and nothing else.
    expect(FakeNotification.raised[0]?.options).toEqual({
      body: QA_TURN_NOTICE_BODY,
    });
    const payload = FakeNotification.payload();
    expect(payload).toContain(QA_TURN_NOTICE_BODY);
    expect(payload).not.toContain(FOREIGN);
    expect(payload).not.toContain("Борис");
    expect(payload).not.toContain("a@b.co");
  });

  it("says nothing at all when only the shared chat settled", async () => {
    const accounts = await signedInAdmin();
    const page = mountPage(accounts, IDLE);
    page.redraw(RUNNING);
    page.redraw(OWN_STILL_RUNNING);

    expect(screen.queryByTestId("qa-turn-notice-item")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);
  });

  it("stops reporting a chat the account lost, though the sidebar still lists it", async () => {
    // The merged list is wider than ownership by design, so a chat the account
    // stops owning stays on screen: the row the notice reads is the narrow list,
    // and it has to be re-read rather than trusted from the merged one.
    const owned = [OWN];
    const accounts = await signedInAdmin({ owned });
    const page = mountPage(accounts, IDLE);
    page.redraw(RUNNING);
    owned.length = 0;
    await accounts.refreshOwned();
    expect(accounts.ownedIds()).toEqual([OWN, FOREIGN]);
    expect(accounts.ownIds()).toEqual([]);
    page.redraw(IDLE);

    expect(screen.queryByTestId("qa-turn-notice-item")).toBeNull();
    expect(FakeNotification.raised).toEqual([]);
  });

  it("leaves an ordinary reader's notice exactly as it was", async () => {
    // The same account with the shared history switched off: nothing is wider
    // than ownership, so the notice is the one this reader always got.
    const accounts = await signedInAdmin({ showOtherUsersChats: false });
    expect(accounts.ownedIds()).toEqual([OWN]);
    const page = mountPage(accounts, IDLE);
    page.watchBothTurns();

    expect(screen.getByText(`Чат ${OWN}`)).toBeTruthy();
    expect(screen.queryByText(`Чат ${FOREIGN}`)).toBeNull();
  });
});
