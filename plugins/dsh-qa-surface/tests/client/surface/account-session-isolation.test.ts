import { afterEach, describe, expect, it, vi } from "vitest";
import { createQaAccountSessions } from "../../../src/client/account-sessions.js";
import type { QaSessions } from "../../../src/client/types.js";
import type { QaSessionRemotes } from "../../../src/client/chat-sharing-api.js";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/types";

afterEach(() => vi.useRealTimers());
const row = (id: string) =>
  ({
    sessionId: id,
    updatedAt: 0,
    running: false,
    blank: true,
    agentAvailable: true,
  }) as SessionSummary;

function transport() {
  vi.useFakeTimers();
  let identity: string | null = "account-a";
  let connection: unknown = { generation: 1 };
  let notifyAccount = () => {};
  let notifyGeneration = () => {};
  let secured: QaSessionRemotes;
  const added = vi.fn();
  const removed = vi.fn();
  const pending: ((items: SessionSummary[]) => void)[] = [];
  const dispose: (() => void)[] = [];
  class Native {
    constructor(_ctx: unknown, remotes: QaSessionRemotes) {
      secured = remotes;
    }
    refresh = vi.fn(async () => undefined);
    handleConnected = vi.fn();
    handleSessionAdded = added;
    handleSessionRemoved = removed;
  }
  const ctx = {
    isolate: () => ctx,
    effect: (setup: () => () => void) => dispose.push(setup()),
  };
  const sessions = createQaAccountSessions(
    ctx as never,
    { constructor: Native } as unknown as QaSessions,
    { session: {}, $stream: vi.fn() } as never,
    {
      chatControl: () => ({ async *[Symbol.asyncIterator]() {} }),
      chatList: () =>
        new Promise((resolve) =>
          pending.push((items) => resolve({ ok: true, value: { items } })),
        ),
    } as never,
    () => identity,
    {
      getSnapshot: () => connection,
      subscribe: (listener: () => void) => {
        notifyGeneration = listener;
        return () => {};
      },
    } as never,
    (listener) => {
      notifyAccount = listener;
      return () => {};
    },
  );
  return {
    sessions,
    added,
    removed,
    pending,
    list: () => secured.session.list({}),
    account: (value: string | null) => {
      identity = value;
      notifyAccount();
    },
    reconnect: () => {
      connection = { generation: 2 };
      notifyGeneration();
    },
    dispose: () => {
      for (const close of dispose) close();
    },
  };
}

describe("account catalog publication", () => {
  it("rejects an old account's list after the new account was published", async () => {
    const t = transport();
    try {
      const a = t.list();
      t.account("account-b");
      const b = t.list();
      t.pending[1]!([row("chat-b")]);
      await b;
      t.pending[0]!([row("chat-a")]);
      await a;
      expect(t.added.mock.calls.map(([item]) => item.sessionId)).toEqual([
        "chat-b",
      ]);
      expect(t.removed).not.toHaveBeenCalledWith("chat-b");
    } finally {
      t.dispose();
    }
  });

  it.each(["logout", "reconnect", "dispose"])(
    "rejects a late list after %s",
    async (change) => {
      const t = transport();
      try {
        const old = t.list();
        if (change === "logout") t.account(null);
        if (change === "reconnect") t.reconnect();
        if (change === "dispose") t.dispose();
        t.pending[0]!([row("chat-old")]);
        await old;
        expect(t.added).not.toHaveBeenCalled();
      } finally {
        t.dispose();
      }
    },
  );

  it("keeps a successful create through a pre-create list, then accepts its real row", async () => {
    const t = transport();
    try {
      const old = t.list();
      t.sessions.rememberAdmitted?.("chat-created");
      expect(t.added).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "chat-created" }),
      );
      t.pending[0]!([]);
      expect(await old).toMatchObject({
        ok: true,
        value: {
          items: [expect.objectContaining({ sessionId: "chat-created" })],
        },
      });
      expect(t.removed).not.toHaveBeenCalledWith("chat-created");
      const fresh = t.list();
      t.pending[1]!([row("chat-created")]);
      await fresh;
      const deleted = t.list();
      t.pending[2]!([]);
      await deleted;
      expect(t.removed).toHaveBeenCalledWith("chat-created");
    } finally {
      t.dispose();
    }
  });
});
