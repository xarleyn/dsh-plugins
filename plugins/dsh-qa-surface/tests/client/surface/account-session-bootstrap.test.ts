import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { ConnectionGenerationState } from "@deepseek-ai/dsh-client-connection/client";
import type { QaSessions } from "../../../src/client/types.js";
import type {
  QaChatWire,
  QaSessionRemotes,
} from "../../../src/client/chat-sharing-api.js";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/types";
import { createQaAccountSessions } from "../../../src/client/account-sessions.js";

afterEach(() => vi.useRealTimers());

/** One catalog row shaped the way the QA chat listing answers. */
function listedRow(sessionId: string): SessionSummary {
  return {
    sessionId,
    updatedAt: 0,
    agentAvailable: false,
    formatStatus: "current",
    running: false,
    blank: true,
  } as SessionSummary;
}

describe("account Session bootstrap", () => {
  it("does not reset an in-flight catalog on repeated account notifications", () => {
    vi.useFakeTimers();
    const connected = vi.fn();
    class NativeSessions {
      refresh = vi.fn(async () => undefined);
      handleConnected = connected;
      handleSessionAdded = vi.fn();
      handleSessionRemoved = vi.fn();
    }
    const disposers: (() => void)[] = [];
    const ctx = {
      isolate: () => ctx,
      effect: (setup: () => () => void) => disposers.push(setup()),
    } as unknown as Context;
    let notifyAccount: () => void = () => undefined;
    let notifyGeneration: () => void = () => undefined;
    let snapshot: unknown = { generation: 1 };
    const generation = {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        notifyGeneration = listener;
        return () => undefined;
      },
    } as unknown as ConnectionGenerationState;
    const remote = {
      session: {},
      $stream: vi.fn(),
    } as unknown as QaSessionRemotes;
    const wire = {
      chatControl: () => ({
        async *[Symbol.asyncIterator]() {
          /* Empty control baseline. */
        },
      }),
    } as unknown as QaChatWire;
    try {
      createQaAccountSessions(
        ctx,
        { constructor: NativeSessions } as unknown as QaSessions,
        remote,
        wire,
        () => "synthetic-account-token",
        generation,
        (listener) => {
          notifyAccount = listener;
          return () => undefined;
        },
      );
      expect(connected).toHaveBeenCalledTimes(1);
      for (let index = 0; index < 5; index++) notifyAccount();
      expect(connected).toHaveBeenCalledTimes(1);
      snapshot = { generation: 2 };
      notifyGeneration();
      expect(connected).toHaveBeenCalledTimes(2);
    } finally {
      for (const dispose of disposers) dispose();
    }
  });

  it("does not access uninjected native command namespaces and keeps their writes refused", async () => {
    vi.useFakeTimers();
    let secured: QaSessionRemotes | undefined;
    class NativeSessions {
      constructor(_context: unknown, remotes: QaSessionRemotes) {
        secured = remotes;
      }
      refresh = vi.fn(async () => undefined);
      handleConnected = vi.fn();
      handleSessionAdded = vi.fn();
      handleSessionRemoved = vi.fn();
    }
    const disposers: (() => void)[] = [];
    const ctx = {
      isolate: () => ctx,
      effect: (setup: () => () => void) => disposers.push(setup()),
    } as unknown as Context;
    const remote = new Proxy(
      { session: {}, $stream: vi.fn() },
      {
        get: (target, key) => {
          if (key === "commands" || key === "subagents")
            throw new Error("namespace was not injected");
          return Reflect.get(target, key);
        },
      },
    ) as unknown as QaSessionRemotes;
    const wire = {
      chatList: vi.fn(async () => ({ ok: true, value: { items: [] } })),
    } as unknown as QaChatWire;
    const generation = {
      getSnapshot: () => undefined,
      subscribe: () => () => undefined,
    } as unknown as ConnectionGenerationState;
    try {
      createQaAccountSessions(
        ctx,
        { constructor: NativeSessions } as unknown as QaSessions,
        remote,
        wire,
        () => "synthetic-account-token",
        generation,
        () => () => undefined,
      );
      expect(secured).toBeDefined();
      await secured!.session.list({});
      expect(wire.chatList).toHaveBeenCalledWith(
        "synthetic-account-token",
        undefined,
      );
      await expect(
        (secured!.commands.execute as () => Promise<unknown>)(),
      ).rejects.toThrow("authenticated QA operation");
      await expect(
        (secured!.subagents.prompt as () => Promise<unknown>)(),
      ).rejects.toThrow("authenticated QA operation");
    } finally {
      for (const dispose of disposers) dispose();
    }
  });

  it("replays every listing through the manager's addition and removal paths", async () => {
    vi.useFakeTimers();
    const added = vi.fn();
    const removed = vi.fn();
    let listing: { ok: true; value: { items: SessionSummary[] } } = {
      ok: true,
      value: { items: [listedRow("session-first")] },
    };
    let secured: QaSessionRemotes | undefined;
    class NativeSessions {
      constructor(_context: unknown, remotes: QaSessionRemotes) {
        secured = remotes;
      }
      refresh = vi.fn(async () => undefined);
      handleConnected = vi.fn();
      handleSessionAdded = added;
      handleSessionRemoved = removed;
    }
    const disposers: (() => void)[] = [];
    const ctx = {
      isolate: () => ctx,
      effect: (setup: () => () => void) => disposers.push(setup()),
    } as unknown as Context;
    const remote = {
      session: {},
      $stream: vi.fn(),
    } as unknown as QaSessionRemotes;
    const wire = {
      chatList: vi.fn(async () => listing),
    } as unknown as QaChatWire;
    const generation = {
      getSnapshot: () => undefined,
      subscribe: () => () => undefined,
    } as unknown as ConnectionGenerationState;
    try {
      createQaAccountSessions(
        ctx,
        { constructor: NativeSessions } as unknown as QaSessions,
        remote,
        wire,
        () => "synthetic-account-token",
        generation,
        () => () => undefined,
      );
      const listed = await securedSessionList(secured);
      expect(listed.ok).toBe(true);
      // The row reached the manager even if the manager's own application of
      // the pull is lost to a generation reset.
      expect(added).toHaveBeenCalledWith(listing.value.items[0]);

      listing = { ok: true, value: { items: [listedRow("session-second")] } };
      await securedSessionList(secured);
      expect(removed).toHaveBeenCalledWith("session-first");
      expect(added).toHaveBeenLastCalledWith(listing.value.items[0]);
    } finally {
      for (const dispose of disposers) dispose();
    }
  });
});

/** Read one listing through the secured transport the way the facade does. */
async function securedSessionList(
  secured: QaSessionRemotes | undefined,
): Promise<{ ok: boolean; value: { items: SessionSummary[] } }> {
  const result = await (
    secured!.session.list as (
      request: unknown,
    ) => Promise<{ ok: boolean; value: { items: SessionSummary[] } }>
  )({});
  expect(result.ok).toBe(true);
  return result;
}
