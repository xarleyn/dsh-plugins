import { describe, expect, it } from "vitest";
import type {
  QaAccountsController,
  QaAccountsSnapshot,
} from "../src/client/QaAccountsController.js";
import { QaUserSessionMirror } from "../src/client/settings-extensions/user-session.js";

/** Minimal source with the three members the mirror reads. */
function source() {
  let snapshot: QaAccountsSnapshot = { stage: "checking" };
  let token: string | null = null;
  const listeners = new Set<() => void>();
  return {
    controller: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      token: () => token,
    } as unknown as QaAccountsController,
    emit(next: QaAccountsSnapshot, nextToken: string | null = null) {
      snapshot = next;
      token = nextToken;
      for (const listener of [...listeners]) listener();
    },
  };
}

const GATE: QaAccountsSnapshot = {
  stage: "gate",
  mode: "login",
  busy: false,
  error: null,
};

describe("QA user session service", () => {
  it("stays in checking until a controller is attached", () => {
    const mirror = new QaUserSessionMirror();
    let notices = 0;
    mirror.subscribe(() => notices++);
    expect(mirror.getSnapshot()).toEqual({ stage: "checking", token: null });
    // Detaching (or never attaching) publishes nothing new.
    mirror.attach(undefined);
    expect(notices).toBe(0);
  });

  it("publishes the token only for a signed-in account", () => {
    const mirror = new QaUserSessionMirror();
    const account = source();
    const seen: (string | null)[] = [];
    mirror.subscribe(() => seen.push(mirror.getSnapshot().token));
    mirror.attach(account.controller);
    account.emit(GATE);
    expect(mirror.getSnapshot()).toEqual({ stage: "anonymous", token: null });
    account.emit(
      {
        stage: "authed",
        user: { id: "u-1" } as never,
        ownedIds: [],
        ownership: [],
        ownedRevision: 0,
      },
      "qa-token-1",
    );
    expect(mirror.getSnapshot()).toEqual({
      stage: "authed",
      token: "qa-token-1",
    });
    expect(seen).toEqual([null, "qa-token-1"]);
  });

  it("reports an authed account without a token as anonymous", () => {
    const mirror = new QaUserSessionMirror();
    const account = source();
    mirror.attach(account.controller);
    account.emit(
      {
        stage: "authed",
        user: { id: "u-1" } as never,
        ownedIds: [],
        ownership: [],
        ownedRevision: 0,
      },
      null,
    );
    expect(mirror.getSnapshot()).toEqual({ stage: "anonymous", token: null });
  });

  it("keeps the snapshot identity until a fact moves", () => {
    const mirror = new QaUserSessionMirror();
    const account = source();
    mirror.attach(account.controller);
    account.emit(GATE);
    const first = mirror.getSnapshot();
    account.emit(GATE);
    expect(mirror.getSnapshot()).toBe(first);
  });

  it("detaches the previous controller and stops publishing after disposal", () => {
    const mirror = new QaUserSessionMirror();
    const first = source();
    const second = source();
    mirror.attach(first.controller);
    first.emit(GATE);
    mirror.attach(second.controller);
    // A stale source must not move the published state any more.
    first.emit(GATE, "stale");
    expect(mirror.getSnapshot()).toEqual({ stage: "checking", token: null });
    let notices = 0;
    mirror.subscribe(() => notices++);
    mirror.dispose();
    second.emit(GATE);
    expect(notices).toBe(0);
  });
});
