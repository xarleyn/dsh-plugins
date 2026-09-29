import { describe, expect, it } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { registerTurnFailureLog } from "../../src/turn-failure-log.js";

interface LoggedRecord {
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

type SessionEventListener = (session: Session, event: SessionEvent) => void;

/**
 * The two host seams the listener touches: an event bus that records whether the
 * listener asked for the sessions outside its own context, and a logger that
 * keeps the records instead of writing them.
 */
function harness(options: { readonly provider?: string } = {}) {
  const records: LoggedRecord[] = [];
  const hooks: { global?: boolean; listener: SessionEventListener }[] = [];
  const sessionOf = (id: string): Session =>
    ({
      id,
      requestHeader: () =>
        options.provider === undefined
          ? undefined
          : { config: { provider: options.provider } },
    }) as unknown as Session;
  const ctx = {
    on: (
      name: string,
      listener: SessionEventListener,
      opts?: { global?: boolean },
    ) => {
      expect(name).toBe("session/event");
      const hook: { global?: boolean; listener: SessionEventListener } = {
        listener,
        ...(opts?.global === true ? { global: true } : {}),
      };
      hooks.push(hook);
      return () => {
        const index = hooks.indexOf(hook);
        if (index >= 0) hooks.splice(index, 1);
        return index >= 0;
      };
    },
  } as unknown as Context;
  const logger = {
    error: (event: string, fields: Record<string, unknown>) =>
      records.push({ event, fields }),
  } as unknown as PluginLogger;
  const qaSessions = new Set(["chat-1"]);
  const dispose = registerTurnFailureLog(ctx, logger, (sessionId) =>
    qaSessions.has(sessionId),
  );
  const emit = (event: SessionEvent, id = "chat-1"): void => {
    for (const hook of [...hooks]) {
      hook.listener(sessionOf(id), event);
    }
  };
  return {
    records,
    dispose,
    emit,
    hooks,
    globalListeners: () => hooks.filter((hook) => hook.global === true).length,
  };
}

function turnEnd(
  reason: Readonly<Record<string, unknown>>,
  turn = 3,
): SessionEvent {
  return {
    type: "turn/end",
    data: { turn, reason },
  } as unknown as SessionEvent;
}

/** The failure of the stand: the route was asked of a registry left empty. */
const NO_ADAPTER = {
  kind: "error",
  error: {
    code: "NO_ADAPTER",
    message: 'no adapter registered for provider "local-dev"',
  },
};

describe("the failed turn in the operator's log", () => {
  it("records the code and the provider the request was routed to", () => {
    const world = harness({ provider: "local-dev" });
    world.emit(turnEnd(NO_ADAPTER));
    expect(world.records).toEqual([
      {
        event: "session.turn-failed",
        fields: {
          sessionId: "chat-1",
          turn: 3,
          code: "NO_ADAPTER",
          provider: "local-dev",
        },
      },
    ]);
  });

  it("keeps the provider's own message out of the record", () => {
    const world = harness({ provider: "local-dev" });
    world.emit(turnEnd(NO_ADAPTER));
    expect(JSON.stringify(world.records)).not.toContain(
      "no adapter registered",
    );
    expect(world.records[0]?.fields).not.toHaveProperty("message");
  });

  it("still names the code when no request header has folded yet", () => {
    const world = harness();
    world.emit(turnEnd(NO_ADAPTER));
    expect(world.records[0]?.fields).toEqual({
      sessionId: "chat-1",
      turn: 3,
      code: "NO_ADAPTER",
    });
  });

  it("writes nothing for a turn that ended without a failure", () => {
    const world = harness({ provider: "local-dev" });
    world.emit(turnEnd({ kind: "completed" }));
    world.emit(turnEnd({ kind: "aborted", reason: { kind: "user" } }));
    world.emit(turnEnd({ kind: "interrupted" }));
    world.emit({
      type: "turn/start",
      data: { turn: 3 },
    } as unknown as SessionEvent);
    expect(world.records).toEqual([]);
  });

  it("writes nothing for a session that is nobody's chat", () => {
    const world = harness({ provider: "local-dev" });
    world.emit(turnEnd(NO_ADAPTER), "foreign-1");
    expect(world.records).toEqual([]);
  });

  it("hears every session of the process until it is disposed", () => {
    const world = harness({ provider: "local-dev" });
    expect(world.globalListeners()).toBe(1);
    world.dispose();
    expect(world.hooks).toHaveLength(0);
    world.emit(turnEnd(NO_ADAPTER));
    expect(world.records).toEqual([]);
  });
});
