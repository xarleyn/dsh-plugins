import { describe, expect, it } from "vitest";

import { AnswerReviewGate, type GateAgent } from "../src/gate.js";
import type { ReviewAudit } from "../src/audit.js";
import type { ResolvedAnswerReviewGateConfig } from "../src/config.js";
import type {
  ReviewVerdict,
  SubagentRunHandle,
  SubagentRunResult,
  SubagentsFace,
  SubagentStartSpec,
} from "../src/types.js";

const PASS: ReviewVerdict = {
  verdict: "pass",
  summary: "All claims check out.",
  issues: [],
  confidence: "high",
};

const REVISE: ReviewVerdict = {
  verdict: "revise",
  summary: "One claim is unsupported.",
  issues: [
    {
      severity: "major",
      category: "unsupported",
      claim: "The default is 512",
      problem: "No source states this",
      requiredFix: "Verify against the code",
    },
  ],
  confidence: "medium",
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
      allowedTools: [],
    },
    maxReviewRounds: 3,
    failMode: "warn",
    trackBackgroundDelegations: true,
    minCandidateChars: 10,
    excludedAgents: [],
    audit: { enabled: true, maxEntries: 100 },
    ...overrides,
  };
}

function sessionOf(
  candidate: string,
  request = "the question",
  origin = "user",
) {
  return {
    header: { origin },
    surface: {
      nodes: [0, 1],
    },
    eventAt: (seq: number) =>
      seq === 0
        ? {
            type: "user/message",
            data: {
              source: { kind: "user" },
              content: [{ type: "text", text: request }],
            },
          }
        : {
            type: "assistant/message",
            data: {
              message: { content: [{ type: "text", text: candidate }] },
              stream: [],
            },
          },
  } as unknown as GateAgent["session"];
}

function agentOf(sessionId = "session-1", origin = "user"): GateAgent {
  return {
    id: sessionId,
    session: { header: { origin } } as GateAgent["session"],
    steer: () => {},
  };
}

interface SteerRecord {
  readonly text: string;
  readonly summary: string;
}

/** Scripted subagent face: each start consumes the next queued result. */
class ScriptedFace implements SubagentsFace {
  readonly started: SubagentStartSpec[] = [];
  readonly queue: ((result: SubagentRunResult | Error) => void)[] = [];

  start(
    _provider: string,
    request: SubagentStartSpec,
  ): Promise<SubagentRunHandle> {
    this.started.push(request);
    return new Promise((resolve) => {
      this.queue.push((outcome) => {
        resolve({
          result:
            outcome instanceof Error
              ? Promise.reject(outcome)
              : Promise.resolve(outcome),
          dispose: () => {},
        });
      });
    });
  }

  settle(outcome: SubagentRunResult | Error): Promise<void> {
    const next = this.queue.shift();
    if (next === undefined) return Promise.resolve();
    next(outcome);
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  resultOf(verdict: ReviewVerdict): SubagentRunResult {
    return { stopReason: "completed", output: [], structured: verdict };
  }
}

function makeGate(
  face: ScriptedFace,
  overrides: Partial<ResolvedAnswerReviewGateConfig> = {},
  steers: SteerRecord[] = [],
) {
  const audit: ReviewAudit = {
    resize: () => {},
    record: () => {},
    list: () => [],
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
  return gate;
}

const TEXT_A =
  "The runtime uses file locks around journal writes, as documented.";
const TEXT_B =
  "The runtime uses file locks around journal writes; verified in source.";

async function stop(
  gate: AnswerReviewGate,
  text: string,
  sessionId = "session-1",
) {
  const agent = agentOf(sessionId);
  (agent as { session: unknown }).session = sessionOf(text);
  return gate.handleTurnStopping(agent, 1, new AbortController().signal);
}

describe("AnswerReviewGate lifecycle", () => {
  it("PASS allows the close and the same candidate is not reviewed twice", async () => {
    const face = new ScriptedFace();
    const gate = makeGate(face);
    const pending = stop(gate, TEXT_A);
    await face.settle(face.resultOf(PASS));
    expect(await pending).toBe("pass");
    expect(face.started).toHaveLength(1);
    expect(await stop(gate, TEXT_A)).toBeNull();
    expect(face.started).toHaveLength(1);
  });

  it("a changed candidate invalidates the PASS and is reviewed again", async () => {
    const face = new ScriptedFace();
    const gate = makeGate(face);
    const first = stop(gate, TEXT_A);
    await face.settle(face.resultOf(PASS));
    expect(await first).toBe("pass");

    const second = stop(gate, TEXT_B);
    await face.settle(face.resultOf(PASS));
    expect(await second).toBe("pass");
    expect(face.started).toHaveLength(2);
  });

  it("REVISE steers the findings back into the primary", async () => {
    const face = new ScriptedFace();
    const steers: SteerRecord[] = [];
    const gate = makeGate(face, {}, steers);
    const pending = stop(gate, TEXT_A);
    await face.settle(face.resultOf(REVISE));
    expect(await pending).toBe("revise");
    expect(steers).toHaveLength(1);
    expect(steers[0]!.text).toContain("unsupported");
    expect(steers[0]!.text).toContain("Verify against the code");
    expect(steers[0]!.text).toContain("round 1 of 3");
    expect(steers[0]!.summary.length).toBeGreaterThan(0);
  });

  it("background work suppresses review until its settlement notice arrives", async () => {
    const face = new ScriptedFace();
    const gate = makeGate(face);
    gate.delegation.observeToolResult(
      { name: "subagent", agent: { id: "session-1" } },
      { isError: false, value: { kind: "continuable", subagentId: "child-a" } },
      1,
    );
    expect(await stop(gate, TEXT_A)).toBe("suppressed-pending-work");
    expect(face.started).toHaveLength(0);

    gate.delegation.observeInboxInsert("session-1", {
      source: { kind: "subagent-settled", senderSessionId: "child-a" },
    });
    const pending = stop(gate, TEXT_A);
    await face.settle(face.resultOf(PASS));
    expect(await pending).toBe("pass");
    expect(face.started).toHaveLength(1);
  });

  it("skips subagents, excluded agents, disabled gates and trivial candidates", async () => {
    const face = new ScriptedFace();
    const gate = makeGate(face, { excludedAgents: ["special"] });

    const reviewerAgent = agentOf("reviewer-child");
    (reviewerAgent as { session: unknown }).session = sessionOf(
      TEXT_A,
      "the question",
      "subagent",
    );
    expect(
      await gate.handleTurnStopping(
        reviewerAgent,
        1,
        new AbortController().signal,
      ),
    ).toBeNull();

    const excludedAgent = agentOf("special-session");
    (excludedAgent as { session: unknown }).session = sessionOf(TEXT_A);
    expect(
      await gate.handleTurnStopping(
        excludedAgent,
        1,
        new AbortController().signal,
      ),
    ).toBeNull();

    const disabled = makeGate(new ScriptedFace(), { enabled: false });
    expect(await stop(disabled, TEXT_A)).toBeNull();

    expect(await stop(gate, "too short")).toBeNull();
    expect(face.started).toHaveLength(0);
  });

  it("enforces the round limit and never reviews two candidates at once", async () => {
    const face = new ScriptedFace();
    const steers: SteerRecord[] = [];
    const gate = makeGate(
      face,
      { maxReviewRounds: 1, failMode: "open" },
      steers,
    );
    const first = stop(gate, TEXT_A);
    // Reentrant boundary while the first review is in flight: no second reviewer.
    expect(
      await gate.handleTurnStopping(agentOf(), 1, new AbortController().signal),
    ).toBeNull();
    await face.settle(face.resultOf(REVISE));
    expect(await first).toBe("revise");
    expect(face.started).toHaveLength(1);
    expect(steers).toHaveLength(1);
    expect(steers[0]!.text).toContain("round 1 of 1");

    // Round budget is spent for this turn: failure policy, open mode — audited,
    // allowed, and no additional failure steer.
    expect(await stop(gate, TEXT_B)).toBe("failure");
    expect(steers).toHaveLength(1);
    expect(face.started).toHaveLength(1);
  });
});

describe("AnswerReviewGate failure policy", () => {
  it("reviewer failures are never converted into a PASS", async () => {
    for (const [failMode, expectedSteers] of [
      ["open", 0],
      ["warn", 1],
      ["closed", 1],
    ] as const) {
      const face = new ScriptedFace();
      const steers: SteerRecord[] = [];
      const gate = makeGate(face, { failMode }, steers);
      const pending = stop(gate, TEXT_A);
      await face.settle({
        stopReason: "error",
        output: [],
        diagnostic: "provider down",
      });
      expect(await pending).toBe("failure");
      expect(steers).toHaveLength(expectedSteers);
      if (expectedSteers > 0) {
        expect(steers[0]!.text).toContain("provider down");
        expect(steers[0]!.text).toMatch(
          new RegExp(
            failMode === "closed" ? "unverified" : "did not complete",
            "u",
          ),
        );
      }
    }
  });

  it("malformed reviewer output follows the failure policy", async () => {
    const face = new ScriptedFace();
    const gate = makeGate(face, { failMode: "open" });
    const pending = stop(gate, TEXT_A);
    await face.settle({
      stopReason: "completed",
      output: [{ type: "text", text: "looks good to me" }],
    });
    expect(await pending).toBe("failure");
  });

  it("steers at most one failure notice per turn", async () => {
    const face = new ScriptedFace();
    const steers: SteerRecord[] = [];
    const gate = makeGate(
      face,
      { failMode: "warn", maxReviewRounds: 10 },
      steers,
    );
    const first = stop(gate, TEXT_A);
    await face.settle({ stopReason: "error", output: [] });
    expect(await first).toBe("failure");
    const second = stop(gate, TEXT_B);
    await face.settle({ stopReason: "error", output: [] });
    expect(await second).toBe("failure");
    expect(steers).toHaveLength(1);
  });
});
