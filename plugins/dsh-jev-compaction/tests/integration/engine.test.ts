import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import type { Session as DshSession } from "@deepseek-ai/dsh-session";
import { JevCompactionEngine } from "../../src/backend/engine.js";
import { resolveJevEngineConfig } from "../../src/backend/config.js";
import type { JevEngineConfig } from "../../src/backend/config.js";
import type { TokenMeterLike } from "../../src/dsh/types.js";
import { FakeDecisionBackend, appendToolStep } from "../helpers/session.js";

/** A meter that prices each surface node from its actual payload size. */
function contentTokenMeter(): TokenMeterLike {
  return {
    measure(session: DshSession) {
      const nodes = session.surface.nodes.map((seq) => {
        const event = session.eventAt(seq);
        const text = event === undefined ? "" : JSON.stringify(event.data);
        const tokens = Math.max(1, Math.ceil(text.length / 4));
        return { seq: seq as number, tokens, heuristicTokens: tokens };
      });
      const surfaceTokens = nodes.reduce((sum, node) => sum + node.tokens, 0);
      return {
        logRevision: 0,
        baseline: { kind: "none", tokens: 0 } as const,
        surfaceDeltaTokens: surfaceTokens,
        totalTokens: surfaceTokens,
        surfaceTokens,
        nodes,
      };
    },
    estimateMessage(message: unknown) {
      return Math.max(1, Math.ceil(JSON.stringify(message).length / 4));
    },
  };
}

function fakeLlm(contextWindow: number) {
  return {
    resolveModelInfo: async () => ({ context: { contextWindow } }),
    stream: async function* () {
      yield {
        type: "text-delta",
        index: 0,
        text: "Consolidated checkpoint summary of the earlier work.",
      };
    },
  };
}

interface EngineAgent {
  readonly id: string;
  readonly session: DshSession;
  readonly options: { provider: string; model: string };
  runMaintenance(
    task: (signal: AbortSignal) => Promise<unknown>,
  ): Promise<unknown>;
}

function engineAgent(session: DshSession, id = "engine-agent"): EngineAgent {
  return {
    id,
    session,
    options: { provider: "test", model: "test-model" },
    runMaintenance: async (task) => task(new AbortController().signal),
  };
}

function buildBigSession(
  id: string,
  steps: number,
  options: { openTailTurn?: boolean } = { openTailTurn: true },
): {
  session: DshSession;
  finalTurn: number;
} {
  const session: DshSession = Session.create(SessionId(id));
  for (let index = 0; index < steps; index += 1) {
    appendToolStep(session, index + 1, `call-${index}`, [
      { type: "text", text: "x".repeat(4000) },
    ]);
  }
  const finalTurn = steps + 1;
  if (options.openTailTurn === true) {
    session.append("turn/start", { turn: finalTurn });
    // The inherited basic policy prices pressure against the durably routed
    // request; a real session always has one by the time pressure exists.
    session.append("request/header", {
      header: { config: { provider: "test", model: "test-model" } },
      reason: "initial",
    });
  }
  return { session, finalTurn };
}

const BASE_CONFIG: JevEngineConfig = {
  enabled: true,
  trigger: {
    contextRatio: 0.7,
    minSurfaceTokens: 1,
    minCandidates: 1,
    minCandidateChars: 1,
    cooldownTurns: 0,
  },
  preserve: { recentMessages: 2, recentTokens: 0, errors: true },
  pruning: { minSavingsChars: 0, minSavingsRatio: 0 },
  summaryRatio: 0.82,
};

function buildEngine(
  config: JevEngineConfig,
  backend = new FakeDecisionBackend(0.05),
  contextWindow = 10_000,
): { engine: JevCompactionEngine; ctx: Context } {
  const ctx = new Context();
  const meter = contentTokenMeter();
  (
    ctx as unknown as {
      reflect: { provide(name: string, value: unknown): void };
    }
  ).reflect.provide("tokenMeter", meter);
  (
    ctx as unknown as {
      reflect: { provide(name: string, value: unknown): void };
    }
  ).reflect.provide("llm", fakeLlm(contextWindow));
  (
    ctx as unknown as {
      reflect: { provide(name: string, value: unknown): void };
    }
  ).reflect.provide("sessions", { flush: async () => {} });
  const engine = new JevCompactionEngine(ctx, config, backend);
  return { engine, ctx };
}

function eventTypes(session: DshSession): string[] {
  return session.snapshotEvents().map((event) => event.type);
}

function stubbedResultCount(session: DshSession): number {
  let count = 0;
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq);
    if (event === undefined || event.type !== "tool/result") continue;
    const block = (
      event.data as { message: { content: [{ content: { text: string }[] }] } }
    ).message.content[0];
    if (block.content[0]?.text.includes("[dsh-jev-compaction]") === true) {
      count += 1;
    }
  }
  return count;
}

describe("JevCompactionEngine (backend mode)", () => {
  it("registers under the compaction service name", () => {
    const { engine } = buildEngine(BASE_CONFIG);
    expect(engine.name).toBe("compaction");
    expect(engine.prune.config.enabled).toBe(true);
  });

  it("prunes semantically at the early threshold without summarizing", async () => {
    const { session, finalTurn } = buildBigSession("engine-early", 8);
    const { engine } = buildEngine(BASE_CONFIG);
    const agent = engineAgent(session);

    await engine.prune.handlePreStep(
      {
        agent,
        messages: [],
        turn: finalTurn,
        step: 1,
        signal: new AbortController().signal,
      } as never,
      async () => ({ kind: "enter" as const, messages: [] }),
    );

    expect(stubbedResultCount(session)).toBeGreaterThan(0);
    expect(eventTypes(session)).not.toContain("compaction/summary");

    // The inherited basic policy evaluates pressure at summaryRatio and finds
    // nothing left to do after the semantic prune.
    const result = await engine.compactIfNeeded(
      agent as never,
      "pressure",
      new AbortController().signal,
    );
    expect(result).toBeNull();
    expect(eventTypes(session)).not.toContain("compaction/summary");
  });

  it("falls back to the inherited summary above summaryRatio", async () => {
    const { session, finalTurn } = buildBigSession("engine-summary", 8);
    // Jev wants to keep everything: the early prune applies nothing, so the
    // inherited policy must condense the old span itself.
    const { engine } = buildEngine(BASE_CONFIG, new FakeDecisionBackend(0.95));
    const agent = engineAgent(session);

    await engine.prune.handlePreStep(
      {
        agent,
        messages: [],
        turn: finalTurn,
        step: 1,
        signal: new AbortController().signal,
      } as never,
      async () => ({ kind: "enter" as const, messages: [] }),
    );
    expect(stubbedResultCount(session)).toBe(0);

    await engine.compactIfNeeded(
      agent as never,
      "pressure",
      new AbortController().signal,
    );

    const types = eventTypes(session);
    expect(types).toContain("compaction/start");
    expect(types).toContain("compaction/summary");
    expect(types).toContain("compaction/end");

    // Balanced brackets replay to the identical derived messages.
    const replay = Session.create(session.id, session.snapshotEvents());
    expect(replay.deriveMessages()).toEqual(session.deriveMessages());
  });

  it("supports the inherited /compact entry (compactNow)", async () => {
    // Manual compaction targets an idle session: closed steps, no open turn.
    const { session } = buildBigSession("engine-compact-now", 6, {
      openTailTurn: false,
    });
    const { engine } = buildEngine(BASE_CONFIG);
    await engine.compactNow(
      engineAgent(session) as never,
      new AbortController().signal,
    );
    const types = eventTypes(session);
    expect(types).toContain("compaction/summary");
    expect(types.filter((type) => type === "compaction/end").length).toBe(
      types.filter((type) => type === "compaction/start").length,
    );
  });

  it("applies an armed manual prune through the nested service", async () => {
    const { session, finalTurn } = buildBigSession("engine-armed", 8);
    const { engine } = buildEngine(BASE_CONFIG);
    const agent = engineAgent(session);
    expect(engine.prune.queueManualRun(agent as never)).toBe(true);
    await engine.prune.handlePreStep(
      {
        agent,
        messages: [],
        turn: finalTurn,
        step: 1,
        signal: new AbortController().signal,
      } as never,
      async () => ({ kind: "enter" as const, messages: [] }),
    );
    expect(stubbedResultCount(session)).toBeGreaterThan(0);
  });

  it("still summarises when the early prune fails open", async () => {
    const { session, finalTurn } = buildBigSession("engine-fail-open", 8);
    class BrokenBackend {
      async score(): Promise<Map<string, number>> {
        throw new Error("backend unavailable");
      }
    }
    const { engine } = buildEngine(BASE_CONFIG, new BrokenBackend() as never);
    const agent = engineAgent(session);
    await engine.prune.handlePreStep(
      {
        agent,
        messages: [],
        turn: finalTurn,
        step: 1,
        signal: new AbortController().signal,
      } as never,
      async () => ({ kind: "enter" as const, messages: [] }),
    );
    expect(stubbedResultCount(session)).toBe(0);
    await engine.compactIfNeeded(
      agent as never,
      "pressure",
      new AbortController().signal,
    );
    expect(eventTypes(session)).toContain("compaction/summary");
  });

  it("validates the threshold ordering at construction", () => {
    expect(() =>
      resolveJevEngineConfig({
        trigger: { contextRatio: 0.8 },
        summaryRatio: 0.75,
      }),
    ).toThrow(/summaryRatio/);
    expect(() => resolveJevEngineConfig({ summaryRatio: 1.2 })).toThrow(
      /summaryRatio/,
    );
    const resolved = resolveJevEngineConfig(BASE_CONFIG);
    expect(resolved.engine.summaryRatio).toBe(0.82);
    expect(resolved.basic.thresholdRatio).toBe(0.82);
    expect(resolved.companion.trigger.contextRatio).toBe(0.7);
  });
});
