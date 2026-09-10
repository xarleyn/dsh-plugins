import { describe, expect, it } from "vitest";

import { buildAuditEvent, SAFETY_EVENT_TYPES } from "../../src/audit/events.js";
import { contentSha256, rawPreview } from "../../src/audit/sanitizer.js";
import { SafetyMetrics } from "../../src/audit/metrics.js";
import { TurnRiskTracker } from "../../src/guards/risk-state.js";
import { VERDICT_VERSION, type SafetyVerdict } from "../../src/types.js";

const verdict: SafetyVerdict = {
  version: VERDICT_VERSION,
  decision: "block",
  confidence: 0.93,
  categories: ["prompt_injection"],
  summary: "injection.ignore_previous",
  policyRuleIds: ["injection.ignore_previous"],
};

describe("audit events", () => {
  it("contains no raw content by default", () => {
    const secret = "api_key = 'sk-ant-very-secret-value'";
    const event = buildAuditEvent({
      turn: 12,
      step: 2,
      direction: "output",
      channel: "reasoning",
      toolName: null,
      decision: "block",
      verdict,
      content: secret,
      policyVersion: "1",
      classifier: { provider: "local", model: "safety-small", ran: true },
      latencyMs: 81,
      includeRawContent: false,
    });
    expect(JSON.stringify(event)).not.toContain("sk-ant-very-secret-value");
    expect(event.contentSha256).toBe(contentSha256(secret));
    expect(event.rawContent).toBeUndefined();
    expect(event.decision).toBe("block");
    expect(event.latencyMs).toBe(81);
  });

  it("includes a bounded preview when raw logging is opted in", () => {
    const event = buildAuditEvent({
      turn: null,
      step: null,
      direction: "input",
      channel: "input",
      decision: "warn",
      verdict: { ...verdict, decision: "warn" },
      content: "x".repeat(2_000),
      policyVersion: "1",
      classifier: { provider: "", model: "", ran: false },
      latencyMs: 1,
      includeRawContent: true,
      rawContentMaxChars: 100,
    });
    expect(event.rawContent).toBeDefined();
    expect(event.rawContent?.length).toBeLessThanOrEqual(101);
    expect(event.rawContent).not.toContain("x".repeat(200));
  });

  it("exposes the four stable event type names", () => {
    expect(Object.values(SAFETY_EVENT_TYPES)).toEqual([
      "safety-gate/check",
      "safety-gate/block",
      "safety-gate/warn",
      "safety-gate/classifier-error",
    ]);
  });

  it("sanitizes control characters in raw previews", () => {
    expect(rawPreview("a\u0000b\u200Bc", 50)).toBe("a b c");
  });
});

describe("safety metrics", () => {
  it("counts checks, blocks, classifier usage, and prevented output", () => {
    const metrics = new SafetyMetrics();
    metrics.recordCheck("input");
    metrics.recordCheck("input");
    metrics.recordCheck("reasoning");
    metrics.recordBlock("input");
    metrics.recordBlock("reasoning");
    metrics.recordClassifierCall({ inputTokens: 100, outputTokens: 20 }, 42);
    metrics.recordClassifierError();
    metrics.recordBufferOverflow();
    metrics.recordPreventedOutput(800);
    const snapshot = metrics.snapshot();
    expect(snapshot.checks.input).toBe(2);
    expect(snapshot.checks.reasoning).toBe(1);
    expect(snapshot.blocks.input).toBe(1);
    expect(snapshot.blocks.reasoning).toBe(1);
    expect(snapshot.classifierRequests).toBe(1);
    expect(snapshot.classifierInputTokens).toBe(100);
    expect(snapshot.classifierOutputTokens).toBe(20);
    expect(snapshot.classifierErrors).toBe(1);
    expect(snapshot.bufferOverflows).toBe(1);
    expect(snapshot.estimatedMainTokensPrevented).toBe(200);
    expect(snapshot.classifierLatencyMaxMs).toBe(42);
  });
});

describe("turn risk state", () => {
  it("stamps turns from the input guard and resets on a new turn", () => {
    const tracker = new TurnRiskTracker();
    tracker.beginTurn("s1", 1);
    tracker.mark("s1", { riskLevel: "elevated", source: "web_fetch", signalKey: "injection.ignore_previous" });
    expect(tracker.get("s1")?.riskLevel).toBe("elevated");
    tracker.beginTurn("s1", 2);
    expect(tracker.get("s1")?.riskLevel).toBe("low");
    expect(tracker.get("s1")?.turn).toBe(2);
  });

  it("escalates within a turn but never de-escalates", () => {
    const tracker = new TurnRiskTracker();
    tracker.beginTurn("s1", 1);
    tracker.mark("s1", { riskLevel: "high", source: "web_fetch", signalKey: "k" });
    const state = tracker.mark("s1", { riskLevel: "elevated", source: "docs", signalKey: "k2" });
    expect(state?.riskLevel).toBe("high");
    expect(state?.signals).toContain("k2");
  });

  it("maps decisions through the risk level", () => {
    const tracker = new TurnRiskTracker();
    expect(tracker.escalate("allow", undefined)).toBe("allow");
    expect(tracker.escalate("allow", "elevated")).toBe("ask");
    expect(tracker.escalate("allow", "high")).toBe("ask");
    expect(tracker.escalate("review", "high")).toBe("deny");
    expect(tracker.escalate("block", "low")).toBe("deny");
  });

  it("caps tracked sessions", () => {
    const tracker = new TurnRiskTracker();
    for (let index = 0; index < 600; index += 1) tracker.beginTurn(`s${index}`, 1);
    expect(tracker.get("s0")).toBeUndefined();
    expect(tracker.get("s599")).toBeDefined();
  });
});
