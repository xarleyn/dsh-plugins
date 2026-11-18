import { describe, expect, it, vi } from "vitest";
import { createDomainExpertBackend } from "../src/adapters/reviewers.js";
import { resolveAnswerReviewGateConfig } from "../src/config.js";
import type { DomainExpertsFace, ReviewInput } from "../src/types.js";

const input = (): ReviewInput => ({
  sessionId: "session-review",
  turn: 1,
  requestText: "Check the source.",
  requestAttachments: [],
  candidateText: "A sourced answer.",
  signal: new AbortController().signal,
});
const limits = {
  maxToolCalls: 60,
  maxConsecutiveRefusals: 5,
  timeoutMs: 120_000,
};
const config = resolveAnswerReviewGateConfig({}).reviewer;
const outcome = {
  ok: true,
  code: "",
  message: "",
  result: {
    status: "completed",
    summary: "VERDICT: PASS",
    findings: [],
    conflicts: [],
    structured: true,
  },
};

describe("bounded domain review", () => {
  it("does not start a legacy reviewer even when every numeric limit is zero", async () => {
    const face = { testExpert: vi.fn(), reviewExpert: vi.fn() };
    const backend = createDomainExpertBackend({ face, config });
    await expect(backend.review(input())).rejects.toMatchObject({
      reason: "review-budget-unavailable",
    });
    expect(face.testExpert).not.toHaveBeenCalled();
    expect(face.reviewExpert).not.toHaveBeenCalled();
  });

  it("delivers cancellation to the running unlimited review and discards its late verdict", async () => {
    const parent = new AbortController();
    const observedAbort = vi.fn();
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let finish!: (result: typeof outcome) => void;
    const pending = new Promise<typeof outcome>((resolve) => {
      finish = resolve;
    });
    const reviewExpertBounded: NonNullable<
      DomainExpertsFace["reviewExpertBounded"]
    > = async (_domain, _task, _parent, _images, budget) => {
      expect(budget).toEqual({
        maxToolCalls: 0,
        maxConsecutiveRefusals: 0,
        timeoutMs: 0,
        signal: parent.signal,
      });
      budget.signal.addEventListener("abort", observedAbort, {
        once: true,
      });
      enter();
      return pending;
    };
    const backend = createDomainExpertBackend({
      face: { testExpert: vi.fn(), reviewExpertBounded },
      config,
    });
    const result = backend.review({ ...input(), signal: parent.signal });
    await entered;
    parent.abort();
    expect(observedAbort).toHaveBeenCalledOnce();
    finish(outcome);
    await expect(result).rejects.toMatchObject({ reason: "reviewer-aborted" });
  });
  it("requires the explicit capability instead of passing ignored options to a legacy service", async () => {
    const testExpert = vi.fn();
    const backend = createDomainExpertBackend({
      face: { testExpert },
      config,
      limits,
    });
    await expect(backend.review(input())).rejects.toMatchObject({
      reason: "review-budget-unavailable",
    });
    expect(testExpert).not.toHaveBeenCalled();
  });

  it("passes review limits, images and caller cancellation to the bounded entry", async () => {
    const reviewExpertBounded = vi.fn(async () => outcome);
    const face: DomainExpertsFace = {
      testExpert: vi.fn(),
      reviewExpertBounded,
    };
    const request = input();
    const backend = createDomainExpertBackend({ face, config, limits });
    await expect(backend.review(request)).resolves.toMatchObject({
      verdict: "pass",
    });
    expect(reviewExpertBounded).toHaveBeenCalledOnce();
    expect(reviewExpertBounded).toHaveBeenCalledWith(
      "answer-reviewer",
      expect.any(String),
      "session-review",
      [],
      {
        ...limits,
        timeoutMs: expect.any(Number),
        signal: request.signal,
      },
    );
    expect(face.testExpert).not.toHaveBeenCalled();
  });

  it("does not reset a bounded round by retrying a missing structured verdict", async () => {
    const reviewExpertBounded = vi.fn(async () => ({
      ...outcome,
      result: { ...outcome.result, structured: false, diagnostic: "" },
    }));
    const backend = createDomainExpertBackend({
      face: { testExpert: vi.fn(), reviewExpertBounded },
      config,
      limits,
    });
    await expect(backend.review(input())).rejects.toMatchObject({
      reason: "expert-output-not-captured",
    });
    expect(reviewExpertBounded).toHaveBeenCalledOnce();
  });

  it("routes an exhausted review to failure, never PASS", async () => {
    const backend = createDomainExpertBackend({
      face: {
        testExpert: vi.fn(),
        reviewExpertBounded: async () => ({
          ...outcome,
          result: {
            ...outcome.result,
            status: "error",
            diagnostic: "expert execution stopped: max-tool-calls",
          },
        }),
      },
      config,
      limits,
    });
    await expect(backend.review(input())).rejects.toMatchObject({
      reason: "review-tool-limit",
    });
  });
});
