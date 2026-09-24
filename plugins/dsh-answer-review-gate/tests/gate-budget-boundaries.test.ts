/**
 * Review-budget boundaries around one user request (issue #260).
 *
 * The budget and the PASS receipt belong to the *user* turn — the surface seq of
 * the request the candidate answers — and never to the agent turn. One user
 * request spends several agent turns: a REVISE steer continues the current one,
 * a settlement notice opens a new one, and a fresh user message opens a new
 * request. Keyed by the agent turn, every such boundary handed out a fresh
 * round budget and forgot the receipt, which is how #181 turned into a review
 * loop; keyed by the user request, the loop stays bounded and a receipt applies
 * to exactly the answer that earned it.
 *
 * Each case below is written against that key: the cases that pin the loop shut
 * (1, 2 and 4) fail if the gate is handed the agent turn instead of the request
 * sequence.
 */

import { describe, expect, it } from "vitest";

import {
  AnswerReviewGate,
  type BoundaryOutcome,
  type GateAgent,
} from "../src/gate.js";
import type { ReviewAudit } from "../src/audit.js";
import type { ResolvedAnswerReviewGateConfig } from "../src/config.js";
import type {
  ReviewVerdict,
  SubagentRunHandle,
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
      claim: "The runtime keeps the journal open",
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
    maxReviewRounds: 2,
    failMode: "warn",
    trackBackgroundDelegations: false,
    minCandidateChars: 10,
    excludedAgents: [],
    waiver: { enabled: true, allowedInClosedMode: false },
    audit: { enabled: false, maxEntries: 100 },
    ...overrides,
  };
}

/** A reviewer face that answers each round from a script, immediately. */
class ScriptedReviewer implements SubagentsFace {
  readonly started: SubagentStartSpec[] = [];

  constructor(private readonly verdicts: readonly ReviewVerdict[]) {}

  start(
    _provider: string,
    request: SubagentStartSpec,
  ): Promise<SubagentRunHandle> {
    this.started.push(request);
    const verdict = this.verdicts[this.started.length - 1];
    if (verdict === undefined) {
      return Promise.reject(
        new Error(`unscripted review round ${String(this.started.length)}`),
      );
    }
    return Promise.resolve({
      result: Promise.resolve({
        stopReason: "completed",
        output: [],
        structured: verdict,
      }),
      dispose: () => {},
    });
  }
}

interface SteerRecord {
  readonly text: string;
  readonly summary: string;
}

function makeGate(
  face: SubagentsFace,
  steers: SteerRecord[] = [],
  overrides: Partial<ResolvedAnswerReviewGateConfig> = {},
): AnswerReviewGate {
  const audit = {
    resize: () => {},
    record: () => {},
    list: () => [],
  } as unknown as ReviewAudit;
  return new AnswerReviewGate({
    config: () => config(overrides),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    audit,
    now: () => 0,
    domainExperts: () => undefined,
    subagents: () => face,
    steerMessage: (_agent, text, summary) => {
      steers.push({ text, summary });
    },
  });
}

interface SurfaceEntry {
  readonly kind: "user" | "assistant";
  readonly text: string;
}

function userLine(text: string): SurfaceEntry {
  return { kind: "user", text };
}

function assistantLine(text: string): SurfaceEntry {
  return { kind: "assistant", text };
}

/** A durable surface: real user requests and the assistant messages in order. */
function surfaceOf(...entries: readonly SurfaceEntry[]): GateAgent["session"] {
  const events = entries.map((entry) =>
    entry.kind === "user"
      ? {
          type: "user/message",
          data: {
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

/** One boundary of a scripted session at an explicit agent turn. */
function stopAt(
  gate: AnswerReviewGate,
  session: GateAgent["session"],
  turn: number,
): Promise<BoundaryOutcome> {
  const agent = {
    id: "session-1",
    session,
    steer: () => {},
  } as unknown as GateAgent;
  return gate.handleTurnStopping(agent, turn, new AbortController().signal);
}

const QUESTION = "How does the runtime write its journal?";
const ANSWER_ONE = "The runtime uses file locks around journal writes.";
const ANSWER_TWO =
  "The runtime uses file locks around journal writes, checked.";
const ANSWER_THREE =
  "The runtime uses file locks around journal writes. Final.";

describe("review budget boundaries", () => {
  it("keeps one round budget when a revision returns to the same request", async () => {
    // Case 1: the steer hands the findings back inside the same user request.
    // The second boundary is a new agent turn, and it must continue the budget
    // rather than open a fresh one — that is what bounds the loop.
    const face = new ScriptedReviewer([REVISE, REVISE]);
    const steers: SteerRecord[] = [];
    const gate = makeGate(face, steers);

    expect(
      await stopAt(
        gate,
        surfaceOf(userLine(QUESTION), assistantLine(ANSWER_ONE)),
        1,
      ),
    ).toBe("revise");
    expect(steers[0]!.text).toContain("round 1 of 2");

    expect(
      await stopAt(
        gate,
        surfaceOf(
          userLine(QUESTION),
          assistantLine(ANSWER_ONE),
          assistantLine(ANSWER_TWO),
        ),
        2,
      ),
    ).toBe("revise");
    expect(steers[1]!.text).toContain("round 2 of 2");

    // The third version is past the budget: no third reviewer, failure policy.
    expect(
      await stopAt(
        gate,
        surfaceOf(
          userLine(QUESTION),
          assistantLine(ANSWER_ONE),
          assistantLine(ANSWER_TWO),
          assistantLine(ANSWER_THREE),
        ),
        3,
      ),
    ).toBe("failure");
    expect(face.started).toHaveLength(2);
  });

  it("reviews a settlement notice's answer without moving the receipt or the budget", async () => {
    // Case 2: a settlement notice opens a new agent turn of the same request.
    // The receipt covers the answer it was earned for, not the turn — so the
    // rewritten answer is reviewed — and the round already spent still counts.
    const face = new ScriptedReviewer([PASS, REVISE]);
    const steers: SteerRecord[] = [];
    const gate = makeGate(face, steers);

    expect(
      await stopAt(
        gate,
        surfaceOf(userLine(QUESTION), assistantLine(ANSWER_ONE)),
        1,
      ),
    ).toBe("pass");
    expect(face.started).toHaveLength(1);

    expect(
      await stopAt(
        gate,
        surfaceOf(
          userLine(QUESTION),
          assistantLine(ANSWER_ONE),
          assistantLine(ANSWER_TWO),
        ),
        2,
      ),
    ).toBe("revise");
    expect(face.started).toHaveLength(2);
    expect(steers[0]!.text).toContain("round 2 of 2");
  });

  it("starts a new user request with a clean budget and no receipt", async () => {
    // Case 3: a real user message opens a new user turn. Its first answer gets
    // the whole budget even though the previous request had spent it, and the
    // previous receipt — earned by the same text — does not cover this turn.
    const face = new ScriptedReviewer([PASS, REVISE, PASS]);
    const steers: SteerRecord[] = [];
    const gate = makeGate(face, steers);

    expect(
      await stopAt(
        gate,
        surfaceOf(userLine(QUESTION), assistantLine(ANSWER_ONE)),
        1,
      ),
    ).toBe("pass");

    const newRequest = surfaceOf(
      userLine(QUESTION),
      assistantLine(ANSWER_ONE),
      userLine("And what about the lock held during a write?"),
      assistantLine(ANSWER_ONE),
    );
    expect(await stopAt(gate, newRequest, 2)).toBe("revise");
    expect(steers[0]!.text).toContain("round 1 of 2");
  });

  it("covers the whole session with one budget when no user request is located", async () => {
    // Case 4: `requestSeq: null` is the documented fallback — one budget for
    // the session, so a journal whose user message cannot be located still
    // cannot loop.
    const face = new ScriptedReviewer([REVISE]);
    const gate = makeGate(face, [], { maxReviewRounds: 1 });
    const orphan = surfaceOf(assistantLine(ANSWER_ONE));

    expect(await stopAt(gate, orphan, 1)).toBe("revise");
    expect(face.started).toHaveLength(1);

    expect(await stopAt(gate, surfaceOf(assistantLine(ANSWER_TWO)), 2)).toBe(
      "failure",
    );
    expect(face.started).toHaveLength(1);
  });

  it("has no candidate at all for an empty journal", async () => {
    // Case 5: no surface nodes, and a node whose event is gone — an honest
    // null instead of a crash, and no reviewer is started.
    const face = new ScriptedReviewer([PASS]);
    const gate = makeGate(face);
    const empty = {
      header: { origin: "user" },
      surface: { nodes: [] },
      eventAt: () => undefined,
      snapshotEvents: () => [],
    } as unknown as GateAgent["session"];
    const missingEvent = {
      header: { origin: "user" },
      surface: { nodes: [0] },
      eventAt: () => undefined,
      snapshotEvents: () => [],
    } as unknown as GateAgent["session"];

    expect(await stopAt(gate, empty, 1)).toBeNull();
    expect(await stopAt(gate, missingEvent, 2)).toBeNull();
    expect(face.started).toHaveLength(0);
  });
});
