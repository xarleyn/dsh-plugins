import { describe, expect, it, vi } from "vitest";
import { AnswerReviewGate, type GateAgent } from "../src/gate.js";
import { resolveAnswerReviewGateConfig } from "../src/config.js";
import { ReviewAudit } from "../src/audit.js";
import { collectCandidate } from "../src/candidate.js";
import { reviewStatusNotice, type ReviewReceipt } from "../src/receipt.js";
import {
  createDomainExpertBackend,
  createSubagentBackend,
} from "../src/adapters/reviewers.js";
import type { ExpertRunResult, SubagentRunResult } from "../src/types.js";

const expertPass: ExpertRunResult = {
  status: "completed",
  structured: true,
  summary: "Verified",
  findings: [],
  conflicts: [],
};
const missing: ExpertRunResult = {
  ...expertPass,
  status: "error",
  structured: false,
  summary: "PASS in prose",
};
const captured: SubagentRunResult = {
  stopReason: "completed",
  output: [],
  structured: { verdict: "pass", summary: "Verified", issues: [] },
};
const config = resolveAnswerReviewGateConfig({
  enabled: true,
  minCandidateChars: 10,
  reviewer: { backend: "domain-expert", domain: "answer-reviewer" },
});

function harness(
  results: ExpertRunResult[],
  signal = new AbortController().signal,
) {
  const receipts: ReviewReceipt[] = [];
  const nodes = [0, 1];
  const events = [
    {
      type: "user/message",
      data: {
        source: { kind: "user" },
        content: [{ type: "text", text: "Explain file locks" }],
      },
    },
    {
      type: "assistant/message",
      data: {
        message: {
          content: [
            { type: "text", text: "File locks serialize journal writes." },
          ],
        },
      },
    },
  ];
  const agent = {
    id: "demo-session",
    session: {
      header: { origin: "user" },
      surface: { nodes },
      eventAt: (seq: number) => events[seq],
      snapshotEvents: () => events,
    },
    steer: vi.fn(),
  } as unknown as GateAgent;
  const append = (event: (typeof events)[number]) => {
    events.push(event);
    const seq = events.length - 1;
    nodes.push(seq);
    return seq;
  };
  const reviewExpertBounded = vi.fn(async () => ({
    ok: true,
    code: "",
    message: "",
    result: results.shift()!,
  }));
  const steer = vi.fn();
  const gate = new AnswerReviewGate({
    config: () => config,
    audit: new ReviewAudit(20),
    now: () => 100,
    logger: { info() {}, warn() {}, error() {} },
    domainExperts: () => ({ testExpert: vi.fn(), reviewExpertBounded }),
    subagents: () => undefined,
    steerMessage: steer,
    publishStatus: (_agent, receipt) => {
      receipts.push(receipt);
      append({ type: "user/message", data: reviewStatusNotice(receipt) });
    },
  });
  return {
    gate,
    agent,
    reviewExpertBounded,
    steer,
    receipts,
    answer: (text: string) =>
      append({
        type: "assistant/message",
        data: { message: { content: [{ type: "text", text }] } },
      }),
    run: () => gate.handleTurnStopping(agent, 1, signal),
  };
}

describe("capture recovery and durable review status", () => {
  it("recovers missing expert capture without warning the primary and preserves human request identity", async () => {
    const h = harness([missing, expertPass]);
    expect(await h.run()).toBe("pass");
    expect(h.reviewExpertBounded).toHaveBeenCalledTimes(2);
    expect(h.steer).not.toHaveBeenCalled();
    expect(h.receipts.map((r) => r.status)).toEqual([
      "reviewing",
      "recovering",
      "pass",
    ]);
    expect(
      new Set(
        h.receipts.map(
          (r) => `${r.candidateSeq}:${r.candidateHash}:${r.requestSeq}`,
        ),
      ).size,
    ).toBe(1);
    expect(collectCandidate(h.agent.session)).toMatchObject({
      candidateSeq: 1,
      requestSeq: 0,
      requestText: "Explain file locks",
    });
    expect(await h.run()).toBeNull();
    expect(h.reviewExpertBounded).toHaveBeenCalledTimes(2);
    const candidateSeq = h.answer("File locks serialize journal writes.");
    expect(await h.run()).toBeNull();
    expect(h.reviewExpertBounded).toHaveBeenCalledTimes(2);
    expect(h.receipts.at(-1)).toMatchObject({
      candidateSeq,
      status: "pass",
      details: { summary: "Verified", issues: [], omittedIssues: 0 },
    });
  });

  it("records bounded findings only on the version returned for correction", async () => {
    const summary = "The answer overstates the scope of the lock.";
    const h = harness([
      {
        ...expertPass,
        summary,
        followUps: Array.from({ length: 19 }, () => "Specify the lock scope."),
        findings: [
          {
            claim: "Global lock",
            evidence: ["Evidence ".repeat(500)],
            confidence: "high",
          },
        ],
      },
      expertPass,
    ]);
    expect(await h.run()).toBe("revise");
    const [reviewing, revise] = h.receipts;
    expect(reviewing?.details).toBeUndefined();
    expect(revise).toMatchObject({
      candidateSeq: 1,
      status: "revise",
      details: { summary, omittedIssues: 4 },
    });
    expect(revise?.details?.issues).toHaveLength(16);
    expect(revise?.details?.issues[0]).toMatchObject({
      severity: "major",
      claim: "Global lock",
      problem: expect.stringMatching(/^Reviewer objection.+…$/u),
    });
    expect(revise?.details?.issues[1]?.requiredFix).toBe(
      "Specify the lock scope.",
    );
    const notice = reviewStatusNotice(revise!);
    expect(notice.source).toMatchObject({ receipt: revise });
    expect(JSON.stringify(notice.content)).not.toContain(summary);

    const candidateSeq = h.answer("The lock scope is a single journal.");
    expect(await h.run()).toBe("pass");
    expect(h.receipts.at(-1)).toMatchObject({
      candidateSeq,
      status: "pass",
      details: { summary: "Verified", issues: [], omittedIssues: 0 },
    });
  });

  it("bounds repeated missing captures and emits one failure warning", async () => {
    const h = harness([missing, missing]);
    expect(await h.run()).toBe("failure");
    expect(h.reviewExpertBounded).toHaveBeenCalledTimes(2);
    expect(h.steer).toHaveBeenCalledTimes(1);
    expect(h.receipts.map((r) => r.status)).toEqual([
      "reviewing",
      "recovering",
      "failure",
    ]);
  });

  it.each(["aborted", "error"])(
    "does not retry a real %s diagnostic",
    async (status) => {
      const h = harness([
        {
          ...missing,
          status,
          diagnostic: "request cancelled or provider unavailable",
        },
      ]);
      expect(await h.run()).toBe("failure");
      expect(h.reviewExpertBounded).toHaveBeenCalledTimes(1);
    },
  );

  it("does not publish PASS or steer after cancellation while the expert runs", async () => {
    const controller = new AbortController();
    const h = harness([expertPass], controller.signal);
    h.reviewExpertBounded.mockImplementationOnce(async () => {
      controller.abort();
      return { ok: true, code: "", message: "", result: expertPass };
    });
    expect(await h.run()).toBe("failure");
    expect(h.receipts.map((r) => r.status)).toEqual(["reviewing", "cancelled"]);
    expect(h.steer).not.toHaveBeenCalled();
  });

  it("refuses a completed expert's uncaptured prose PASS", async () => {
    const backend = createDomainExpertBackend({
      config: config.reviewer,
      face: {
        testExpert: vi.fn(),
        reviewExpertBounded: async () => ({
          ok: true,
          code: "",
          message: "",
          result: { ...missing, status: "completed" },
        }),
      },
    });
    await expect(
      backend.review({
        sessionId: "demo",
        turn: 1,
        candidateText: "answer",
        requestText: null,
        requestAttachments: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ reason: "expert-output-not-captured" });
  });

  it("disposes a child before its bounded replacement and uses the same candidate", async () => {
    const lifecycle: string[] = [];
    const prompts: string[] = [];
    const recovery = vi.fn();
    const backend = createSubagentBackend({
      config: { ...config.reviewer, backend: "subagent" },
      parent: "demo",
      face: {
        getProvider(name: string) {
          if (name !== "spawn") return undefined;
          return {
            name,
            capabilities: {
              agentOptions: true,
              agentPreset: true,
              outputSchema: true,
              depthLimit: true,
            },
            inheritsParentContext: true,
          };
        },
        async startActivation(spec) {
          const first = prompts.length === 0;
          lifecycle.push("start");
          prompts.push(JSON.stringify(spec.prompt));
          return {
            childId: "child-session",
            result: Promise.resolve(
              first ? { stopReason: "error", output: [] } : captured,
            ),
            dispose: async () => {
              lifecycle.push("dispose");
            },
          };
        },
      },
    });
    await expect(
      backend.review({
        sessionId: "demo",
        turn: 1,
        candidateText: "SAME IMMUTABLE ANSWER",
        requestText: null,
        requestAttachments: [],
        signal: new AbortController().signal,
        onRecovery: recovery,
      }),
    ).resolves.toMatchObject({ verdict: "pass" });
    expect(lifecycle).toEqual(["start", "dispose", "start", "dispose"]);
    expect(prompts.every((p) => p.includes("SAME IMMUTABLE ANSWER"))).toBe(
      true,
    );
    expect(recovery).toHaveBeenCalledTimes(1);
  });
});
