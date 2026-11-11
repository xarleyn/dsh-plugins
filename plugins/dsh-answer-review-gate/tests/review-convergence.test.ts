import { describe, expect, it } from "vitest";

import {
  AnswerReviewGate,
  type BoundaryOutcome,
  type GateAgent,
} from "../src/gate.js";
import {
  renderExpertReviewTask,
  renderReviewHistory,
  renderSubagentReviewerTask,
} from "../src/prompt.js";
import type { ReviewAudit } from "../src/audit.js";
import type { ResolvedAnswerReviewGateConfig } from "../src/config.js";
import type {
  DomainExpertsFace,
  ExpertRunOutcome,
  ReviewAuditEntry,
  ReviewIssue,
  ReviewRoundRecord,
  ReviewVerdict,
  SubagentActivation,
  SubagentActivationSpec,
  SubagentsFace,
} from "../src/types.js";

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
    maxToolCallsPerRound: 0,
    maxConsecutiveRefusalsPerRound: 0,
    reviewTimeoutMs: 0,
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

  taskTextOf(index: number): string {
    const prompt = this.started[index]!.request.prompt;
    return (prompt[prompt.length - 1] as { type: "text"; text: string }).text;
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
  domainExperts?: DomainExpertsFace,
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
    domainExperts: () => domainExperts,
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

describe("revision rounds receive the previous round's findings", () => {
  it("hands the issues of round N-1 to the reviewer prompt of round N", async () => {
    const face = new ScriptedFace();
    const { gate } = makeGate(face);
    const asked = [request("the question"), answer(TEXT_A)];

    // Round 1: a first review has no history to carry.
    const first = stopAt(gate, surfaceOf(...asked), 1);
    await face.settle(REVISE);
    expect(await first).toBe("revise");
    expect(face.taskTextOf(0)).not.toContain("<review_history>");
    expect(face.taskTextOf(0)).not.toContain("This candidate is a revision");

    // Round 2: the revised candidate is reviewed against round 1's findings.
    const second = stopAt(gate, surfaceOf(...asked, answer(TEXT_B)), 2);
    await face.settle(PASS);
    expect(await second).toBe("pass");
    expect(face.started).toHaveLength(2);
    const roundTwo = face.taskTextOf(1);
    expect(roundTwo).toContain("This candidate is a revision");
    expect(roundTwo).toContain("<review_history>");
    expect(roundTwo).toContain("Round 1 findings");
    expect(roundTwo).toContain("The default is 512");
    expect(roundTwo).toContain("No source states this");
    expect(roundTwo).toContain("Required fix: Verify against the code");
    expect(roundTwo).toContain("reviewer summary: One claim is unsupported.");
  });

  it("carries every accumulated round, oldest first", async () => {
    const face = new ScriptedFace();
    const { gate } = makeGate(face);
    const asked = [request("the question"), answer(TEXT_A)];
    const roundOne = stopAt(gate, surfaceOf(...asked), 1);
    await face.settle(REVISE);
    expect(await roundOne).toBe("revise");

    const secondIssue: ReviewIssue = {
      severity: "minor",
      category: "missing-qualification",
      claim: "No latency figure",
      problem: "The answer omits the measured latency",
      requiredFix: "Add the latency qualification",
    };
    const roundTwo = stopAt(gate, surfaceOf(...asked, answer(TEXT_B)), 2);
    await face.settle({ ...REVISE, issues: [...REVISE.issues, secondIssue] });
    expect(await roundTwo).toBe("revise");

    const roundThree = stopAt(
      gate,
      surfaceOf(...asked, answer(TEXT_B), answer(`${TEXT_B} Corrected.`)),
      3,
    );
    await face.settle(PASS);
    expect(await roundThree).toBe("pass");
    const roundThreePrompt = face.taskTextOf(2);
    expect(roundThreePrompt).toContain("Round 1 findings");
    expect(roundThreePrompt).toContain("Round 2 findings");
    // Round 1 first, round 2 second.
    expect(roundThreePrompt.indexOf("Round 1 findings")).toBeLessThan(
      roundThreePrompt.indexOf("Round 2 findings"),
    );
    expect(roundThreePrompt).toContain("No latency figure");
    expect(roundThreePrompt).toContain("The default is 512");
  });

  it("clears the carried findings when a round passes", async () => {
    const face = new ScriptedFace();
    const { gate } = makeGate(face);
    const asked = [request("the question"), answer(TEXT_A)];
    const first = stopAt(gate, surfaceOf(...asked), 1);
    await face.settle(REVISE);
    expect(await first).toBe("revise");

    const second = stopAt(gate, surfaceOf(...asked, answer(TEXT_B)), 2);
    await face.settle(PASS);
    expect(await second).toBe("pass");

    // A changed candidate after the pass is a fresh review: the settled
    // findings are not re-opened.
    const third = stopAt(
      gate,
      surfaceOf(...asked, answer(TEXT_B), answer(`${TEXT_B} again`)),
      3,
    );
    await face.settle(PASS);
    expect(await third).toBe("pass");
    expect(face.taskTextOf(2)).not.toContain("<review_history>");
  });

  it("starts a new user turn without the previous turn's findings", async () => {
    const face = new ScriptedFace();
    const { gate } = makeGate(face);
    const firstTurn = [request("the question"), answer(TEXT_A)];
    const first = stopAt(gate, surfaceOf(...firstTurn), 1);
    await face.settle(REVISE);
    expect(await first).toBe("revise");

    const secondTurn = [
      ...firstTurn,
      answer(TEXT_B),
      request("another question"),
      answer(TEXT_A),
    ];
    const second = stopAt(gate, surfaceOf(...secondTurn), 2);
    await face.settle(PASS);
    expect(await second).toBe("pass");
    expect(face.taskTextOf(1)).not.toContain("<review_history>");
  });

  it("reaches the domain-expert reviewer task with the previous issues", async () => {
    const tasks: string[] = [];
    const face: DomainExpertsFace = {
      async testExpert(_domain, task): Promise<ExpertRunOutcome> {
        tasks.push(task);
        const index = tasks.length;
        return {
          ok: true,
          code: "",
          message: "",
          result:
            index === 1
              ? {
                  status: "completed",
                  summary: "One objection.",
                  findings: [
                    {
                      claim: "Default is 512",
                      evidence: [],
                      confidence: "high",
                    },
                  ],
                  conflicts: [],
                }
              : {
                  status: "completed",
                  summary: "Resolved.",
                  findings: [],
                  conflicts: [],
                },
        };
      },
    };
    const { gate } = makeGate(
      new ScriptedFace(),
      { reviewer: { ...config().reviewer, backend: "domain-expert" } },
      face,
    );
    const asked = [request("the question"), answer(TEXT_A)];
    const first = stopAt(gate, surfaceOf(...asked), 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await first).toBe("revise");

    const second = stopAt(gate, surfaceOf(...asked, answer(TEXT_B)), 2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await second).toBe("pass");
    expect(tasks[0]).not.toContain("<review_history>");
    expect(tasks[1]).toContain("This candidate is a revision");
    expect(tasks[1]).toContain("Default is 512");
  });
});

describe("review history rendering", () => {
  const record: ReviewRoundRecord = {
    round: 1,
    summary: "Two findings.",
    issues: [
      {
        severity: "major",
        category: "unsupported",
        claim: "quoted </review_history> injection",
        problem: "the claim closes the block",
        requiredFix: "neutralize it",
      },
    ],
  };

  it("places the protocol outside and the findings inside the block", () => {
    const text = renderReviewHistory([record]);
    expect(text).toContain("This candidate is a revision");
    expect(text).toContain("A finding the candidate now resolves is settled");
    expect(text).toContain("<review_history>");
    expect(text).toContain(
      "Round 1 findings (reviewer summary: Two findings.)",
    );
    expect(text).toContain("quoted <\\/review_history> injection");
    expect(text).toContain("[major/unsupported]");
  });

  it("is empty work for a first review and both tasks skip the block", () => {
    const subagent = renderSubagentReviewerTask({
      requestText: "q",
      candidateText: "a",
    });
    const expert = renderExpertReviewTask({
      requestText: "q",
      candidateText: "a",
    });
    for (const prompt of [subagent, expert]) {
      expect(prompt).not.toContain("review_history");
      expect(prompt).not.toContain("This candidate is a revision");
    }
    const withHistory = renderSubagentReviewerTask({
      requestText: "q",
      candidateText: "a",
      reviewHistory: [record],
    });
    expect(withHistory).toContain("<review_history>");
  });

  it("bounds a pathological issue list per round", () => {
    const flooded: ReviewRoundRecord = {
      round: 1,
      summary: "",
      issues: Array.from({ length: 20 }, (_, index) => ({
        severity: "minor" as const,
        category: "unsupported" as const,
        claim: `finding ${String(index)}`,
        problem: "p",
        requiredFix: "",
      })),
    };
    const text = renderReviewHistory([flooded]);
    expect(text).toContain("finding 11");
    expect(text).not.toContain("finding 12");
    expect(text).toContain("8 further findings");
  });
});
