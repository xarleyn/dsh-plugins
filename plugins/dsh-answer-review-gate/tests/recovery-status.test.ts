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
  const testExpert = vi.fn(async () => ({
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
    domainExperts: () => ({ testExpert }),
    subagents: () => undefined,
    steerMessage: steer,
    publishStatus: (_agent, receipt) => {
      receipts.push(receipt);
      const notice = reviewStatusNotice(receipt);
      events.push({ type: "user/message", data: notice });
      nodes.push(events.length - 1);
    },
  });
  return {
    gate,
    agent,
    testExpert,
    steer,
    receipts,
    run: () => gate.handleTurnStopping(agent, 1, signal),
  };
}

describe("capture recovery and durable review status", () => {
  it("recovers missing expert capture without warning the primary and preserves human request identity", async () => {
    const h = harness([missing, expertPass]);
    expect(await h.run()).toBe("pass");
    expect(h.testExpert).toHaveBeenCalledTimes(2);
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
    expect(h.testExpert).toHaveBeenCalledTimes(2);
  });

  it("bounds repeated missing captures and emits one failure warning", async () => {
    const h = harness([missing, missing]);
    expect(await h.run()).toBe("failure");
    expect(h.testExpert).toHaveBeenCalledTimes(2);
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
      expect(h.testExpert).toHaveBeenCalledTimes(1);
    },
  );

  it("does not publish PASS or steer after cancellation while the expert runs", async () => {
    const controller = new AbortController();
    const h = harness([expertPass], controller.signal);
    h.testExpert.mockImplementationOnce(async () => {
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
        testExpert: async () => ({
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
        async start(_provider, request) {
          const first = prompts.length === 0;
          lifecycle.push("start");
          prompts.push(JSON.stringify(request.prompt));
          return {
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
