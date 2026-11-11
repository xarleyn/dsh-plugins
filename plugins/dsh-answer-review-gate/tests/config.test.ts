import { describe, expect, it } from "vitest";

import {
  ANSWER_REVIEW_GATE_DEFAULTS,
  AnswerReviewGateConfigSchema,
  resolveAnswerReviewGateConfig,
  snapshotAnswerReviewGateConfig,
  type LiveAnswerReviewGateConfig,
} from "../src/config.js";

describe("resolveAnswerReviewGateConfig", () => {
  it("exposes budgets to settings and reads subsequent edits without recreating the gate", () => {
    const configured = AnswerReviewGateConfigSchema({
      maxToolCallsPerRound: 120,
      reviewTimeoutMs: 300_000,
    });
    expect(configured.maxToolCallsPerRound).toHaveProperty(
      "get",
      expect.any(Function),
    );
    expect(configured.reviewer).toHaveProperty("get", expect.any(Function));
    let calls = 120;
    let timeout = 300_000;
    const live = {
      maxToolCallsPerRound: { get: () => calls },
      reviewTimeoutMs: { get: () => timeout },
      reviewer: { get: () => ({ roundTimeoutMs: 600_000 }) },
    } as unknown as LiveAnswerReviewGateConfig;
    expect(
      resolveAnswerReviewGateConfig(snapshotAnswerReviewGateConfig(live)),
    ).toMatchObject({ maxToolCallsPerRound: 120, reviewTimeoutMs: 300_000 });
    calls = 180;
    timeout = 420_000;
    expect(
      resolveAnswerReviewGateConfig(snapshotAnswerReviewGateConfig(live)),
    ).toMatchObject({ maxToolCallsPerRound: 180, reviewTimeoutMs: 420_000 });
  });

  it("returns the documented defaults for an empty config", () => {
    expect(resolveAnswerReviewGateConfig(undefined)).toEqual(
      ANSWER_REVIEW_GATE_DEFAULTS,
    );
    expect(resolveAnswerReviewGateConfig({})).toEqual(
      ANSWER_REVIEW_GATE_DEFAULTS,
    );
  });

  it("clamps numeric limits into their safe ranges", () => {
    const resolved = resolveAnswerReviewGateConfig({
      maxReviewRounds: 99,
      maxToolCallsPerRound: 20_000,
      maxConsecutiveRefusalsPerRound: -5,
      reviewTimeoutMs: Number.NaN,
      minCandidateChars: 0,
      audit: { enabled: true, maxEntries: 1 },
    });
    expect(resolved.maxReviewRounds).toBe(10);
    expect(resolved.maxToolCallsPerRound).toBe(10_000);
    expect(resolved.maxConsecutiveRefusalsPerRound).toBe(0);
    expect(resolved.reviewTimeoutMs).toBe(0);
    expect(resolved.minCandidateChars).toBe(1);
    expect(resolved.audit.maxEntries).toBe(10);

    const low = resolveAnswerReviewGateConfig({
      maxReviewRounds: 0,
      audit: { maxEntries: Number.POSITIVE_INFINITY },
    });
    expect(low.maxReviewRounds).toBe(1);
    // Non-finite numbers fall back to the documented default.
    expect(low.audit.maxEntries).toBe(500);

    const junk = resolveAnswerReviewGateConfig({
      maxReviewRounds: Number.NaN,
      minCandidateChars: Number.NaN,
    });
    expect(junk.maxReviewRounds).toBe(
      ANSWER_REVIEW_GATE_DEFAULTS.maxReviewRounds,
    );
    expect(junk.minCandidateChars).toBe(
      ANSWER_REVIEW_GATE_DEFAULTS.minCandidateChars,
    );
  });

  it("normalizes unknown enum values to the defaults", () => {
    const resolved = resolveAnswerReviewGateConfig({
      reviewer: {
        // @ts-expect-error — raw config can carry junk from a settings file.
        backend: "psychic",
      },
      // @ts-expect-error — raw config can carry junk from a settings file.
      failMode: "shrug",
    });
    expect(resolved.reviewer.backend).toBe(
      ANSWER_REVIEW_GATE_DEFAULTS.reviewer.backend,
    );
    expect(resolved.failMode).toBe(ANSWER_REVIEW_GATE_DEFAULTS.failMode);
  });

  it("accepts both documented backends and failure modes", () => {
    const expert = resolveAnswerReviewGateConfig({
      reviewer: { backend: "domain-expert", domain: "  answer-reviewer  " },
      failMode: "closed",
    });
    expect(expert.reviewer.backend).toBe("domain-expert");
    expect(expert.reviewer.domain).toBe("answer-reviewer");
    expect(expert.failMode).toBe("closed");

    const native = resolveAnswerReviewGateConfig({
      reviewer: {
        backend: "subagent",
        provider: " spawn ",
        model: "review-model",
        route: "review-route",
        reasoningEffort: "high",
        persona: "Be adversarial.",
        allowedTools: ["read", "", 42 as unknown as string],
      },
      failMode: "open",
    });
    expect(native.reviewer.backend).toBe("subagent");
    expect(native.reviewer.provider).toBe("spawn");
    expect(native.reviewer.model).toBe("review-model");
    expect(native.reviewer.route).toBe("review-route");
    expect(native.reviewer.reasoningEffort).toBe("high");
    expect(native.reviewer.persona).toBe("Be adversarial.");
    expect(native.reviewer.allowedTools).toEqual(["read"]);
  });

  it("cleans the exclusion list and honors explicit disables", () => {
    const resolved = resolveAnswerReviewGateConfig({
      enabled: false,
      trackBackgroundDelegations: false,
      excludedAgents: ["  reviewer-agent  ", "", "keep-me"],
      waiver: { enabled: false, allowedInClosedMode: true },
    });
    expect(resolved.enabled).toBe(false);
    expect(resolved.trackBackgroundDelegations).toBe(false);
    expect(resolved.excludedAgents).toEqual(["reviewer-agent", "keep-me"]);
    expect(resolved.waiver).toEqual({
      enabled: false,
      allowedInClosedMode: true,
    });
  });
});
