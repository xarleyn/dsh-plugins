import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnswerReviewGate,
  type BoundaryOutcome,
  type GateAgent,
} from "../src/gate.js";
import { resolveAnswerReviewGateConfig } from "../src/config.js";
import type { ReviewAudit } from "../src/audit.js";
import type { ResolvedAnswerReviewGateConfig } from "../src/config.js";
import type {
  ReviewAuditEntry,
  ReviewVerdict,
  SubagentActivation,
  SubagentActivationSpec,
  SubagentsFace,
} from "../src/types.js";

const PASS: ReviewVerdict = {
  verdict: "pass",
  summary: "All claims check out.",
  issues: [],
  confidence: "high",
};

function config(
  overrides: Partial<ResolvedAnswerReviewGateConfig> = {},
): ResolvedAnswerReviewGateConfig {
  return {
    enabled: true,
    reviewer: {
      backend: "subagent",
      domain: "answer-reviewer",
      provider: "spawn",
      model: "",
      route: "",
      reasoningEffort: "",
      persona: "",
      agentPreset: "",
      allowedTools: [],
      roundTimeoutMs: 0,
    },
    maxReviewRounds: 3,
    failMode: "warn",
    trackBackgroundDelegations: true,
    minCandidateChars: 10,
    excludedAgents: [],
    waiver: { enabled: true, allowedInClosedMode: false },
    audit: { enabled: true, maxEntries: 100 },
    ...overrides,
  };
}

function agentOf(sessionId = "session-1"): GateAgent {
  return {
    id: sessionId,
    session: { header: { origin: "user" } } as GateAgent["session"],
    steer: () => {},
  };
}

function surfaceOf(
  ...entries: readonly { kind: "user" | "assistant"; text: string }[]
): GateAgent["session"] {
  const events = entries.map((entry, seq) =>
    entry.kind === "user"
      ? {
          type: "user/message",
          data: {
            id: `request-${String(seq)}`,
            source: { kind: "user" },
            content: [{ type: "text", text: entry.text }],
          },
        }
      : {
          type: "assistant/message",
          data: { message: { content: [{ type: "text", text: entry.text }] } },
        },
  );
  return {
    header: { origin: "user" },
    surface: { nodes: events.map((_, seq) => seq) },
    eventAt: (seq: number) => events[seq],
    snapshotEvents: () => events,
  } as unknown as GateAgent["session"];
}

const TEXT_A =
  "The runtime uses file locks around journal writes, as documented.";
const TEXT_B =
  "The runtime uses file locks around journal writes; verified in source.";

interface SteerRecord {
  readonly text: string;
  readonly summary: string;
}

/** Every start-time option a provider can honor. */
const FULL_CAPABILITIES = {
  agentOptions: true,
  agentPreset: true,
  outputSchema: true,
  depthLimit: true,
};

/** Scripted subagent face: each start consumes the next queued result. */
class ScriptedFace implements SubagentsFace {
  readonly started: SubagentActivationSpec[] = [];
  private readonly queue: ((activation: SubagentActivation) => void)[] = [];

  getProvider(name: string) {
    if (name !== "spawn") return undefined;
    return {
      name,
      capabilities: { ...FULL_CAPABILITIES },
      inheritsParentContext: true,
    };
  }

  startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation> {
    this.started.push(spec);
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  /** Resolves the queued activation with a completed structured verdict. */
  settle(verdict: ReviewVerdict): Promise<void> {
    const next = this.queue.shift();
    if (next === undefined) return Promise.resolve();
    next({
      childId: "child-session",
      result: Promise.resolve({
        stopReason: "completed",
        output: [],
        structured: verdict,
      }),
      dispose: () => {},
    });
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface GateResult {
  readonly gate: AnswerReviewGate;
  readonly steers: SteerRecord[];
  readonly auditEntries: ReviewAuditEntry[];
}

function makeGate(
  face: SubagentsFace,
  overrides: Partial<ResolvedAnswerReviewGateConfig> = {},
): GateResult {
  const steers: SteerRecord[] = [];
  const auditEntries: ReviewAuditEntry[] = [];
  const audit: ReviewAudit = {
    resize: () => {},
    record: (entry: ReviewAuditEntry) => auditEntries.push(entry),
    list: () => auditEntries,
  } as unknown as ReviewAudit;
  const gate = new AnswerReviewGate({
    config: () => config(overrides),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    audit,
    now: (() => {
      let tick = 0;
      return () => (tick += 10);
    })(),
    domainExperts: () => undefined,
    subagents: () => face,
    steerMessage: (_agent, text, summary) => {
      steers.push({ text, summary });
    },
  });
  return { gate, steers, auditEntries };
}

async function stopAt(
  gate: AnswerReviewGate,
  session: GateAgent["session"],
  turn: number,
): Promise<BoundaryOutcome> {
  const agent = agentOf();
  (agent as { session: unknown }).session = session;
  return gate.handleTurnStopping(agent, turn, new AbortController().signal);
}

function request(text: string) {
  return { kind: "user" as const, text };
}

function answer(text: string) {
  return { kind: "assistant" as const, text };
}

describe("per-round review deadline", () => {
  /** A reviewer child that never answers: the stuck-reviewer pathology. */
  class HangingFace implements SubagentsFace {
    readonly started: SubagentActivationSpec[] = [];

    getProvider(name: string) {
      if (name !== "spawn") return undefined;
      return {
        name,
        capabilities: { ...FULL_CAPABILITIES },
        inheritsParentContext: true,
      };
    }

    startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation> {
      this.started.push(spec);
      return Promise.resolve({
        childId: "child-session",
        result: new Promise<never>(() => {}),
        dispose: () => {},
      });
    }
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends a stuck round under the failure policy instead of hanging the turn", async () => {
    vi.useFakeTimers();
    const face = new HangingFace();
    const { gate, steers, auditEntries } = makeGate(face, {
      reviewer: { ...config().reviewer, roundTimeoutMs: 5_000 },
    });

    const pending = stopAt(
      gate,
      surfaceOf(request("the question"), answer(TEXT_A)),
      1,
    );
    expect(face.started).toHaveLength(1);
    // The deadline reaches the backend through the round signal, so a backend
    // that can cancel its child does so.
    const roundSignal = face.started[0]!.signal;
    const aborted: Promise<void> = new Promise((resolve) => {
      roundSignal.addEventListener("abort", () => resolve(), { once: true });
    });
    await vi.advanceTimersByTimeAsync(5_500);
    await aborted;
    expect(await pending).toBe("failure");

    // The turn keeps running: the honest qualification is steered and the
    // failure is audited with its own reason.
    expect(steers).toHaveLength(1);
    expect(steers[0]!.text).toContain("did not complete");
    expect(steers[0]!.text).toContain("review-timeout");
    expect(auditEntries.at(-1)).toMatchObject({
      outcome: "failure",
      failureReason: expect.stringContaining("review-timeout"),
    });

    // The review latch is released: the next candidate starts a fresh review
    // (and is bounded by the same deadline, not wedged forever).
    const second = stopAt(
      gate,
      surfaceOf(
        request("the question"),
        answer(TEXT_A),
        answer(TEXT_B),
      ),
      2,
    );
    expect(face.started).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_500);
    expect(await second).toBe("failure");
    // One failure steer per user turn: the second timeout adds none.
    expect(steers).toHaveLength(1);
  });

  it("does not fire when the reviewer answers within the budget", async () => {
    vi.useFakeTimers();
    const face = new ScriptedFace();
    const { gate } = makeGate(face, {
      reviewer: { ...config().reviewer, roundTimeoutMs: 60_000 },
    });
    const pending = stopAt(
      gate,
      surfaceOf(request("the question"), answer(TEXT_A)),
      1,
    );
    // `settle` flushes through a macrotask, which is a fake timer here.
    const settled = face.settle(PASS);
    await vi.advanceTimersByTimeAsync(0);
    await settled;
    expect(await pending).toBe("pass");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(face.started).toHaveLength(1);
  });

  it("clamps the configured deadline", () => {
    const resolved = resolveAnswerReviewGateConfig({
      reviewer: { roundTimeoutMs: 50 },
    });
    expect(resolved.reviewer.roundTimeoutMs).toBe(10_000);
    const capped = resolveAnswerReviewGateConfig({
      reviewer: { roundTimeoutMs: 9_000_000 },
    });
    expect(capped.reviewer.roundTimeoutMs).toBe(1_800_000);
    const off = resolveAnswerReviewGateConfig({
      reviewer: { roundTimeoutMs: 0 },
    });
    expect(off.reviewer.roundTimeoutMs).toBe(0);
    const junk = resolveAnswerReviewGateConfig({
      reviewer: { roundTimeoutMs: Number.NaN },
    });
    expect(junk.reviewer.roundTimeoutMs).toBe(
      resolveAnswerReviewGateConfig(undefined).reviewer.roundTimeoutMs,
    );
  });
});
