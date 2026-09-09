/**
 * Unit tests for telemetry counters and derived metrics (SPEC §26, §34).
 */

import { describe, expect, it } from "vitest";

import { deriveOffloadMetrics, OffloadCounters } from "../../src/telemetry/counters.js";

describe("OffloadCounters", () => {
  it("accumulates numeric fields and dimensions", () => {
    const counters = new OffloadCounters();
    counters.increment("candidates", 2);
    counters.recordTool("read");
    counters.recordTool("read");
    counters.recordReason("below-threshold");
    const snapshot = counters.snapshot();
    expect(snapshot.candidates).toBe(2);
    expect(snapshot.tools).toEqual({ read: 2 });
    expect(snapshot.reasons).toEqual({ "below-threshold": 1 });
  });

  it("caps runaway dimension keys with an other bucket", () => {
    const counters = new OffloadCounters();
    for (let index = 0; index < 200; index += 1) counters.recordReason(`reason-${index}`);
    const snapshot = counters.snapshot();
    expect(Object.keys(snapshot.reasons).length).toBeLessThanOrEqual(128);
    expect(snapshot.reasons.other).toBe(200 - 127);
  });

  it("returns isolated snapshots", () => {
    const counters = new OffloadCounters();
    counters.increment("started");
    const snapshot = counters.snapshot();
    counters.increment("started");
    expect(snapshot.started).toBe(1);
    expect(counters.snapshot().started).toBe(2);
  });
});

describe("deriveOffloadMetrics (SPEC §34)", () => {
  it("derives reduction, latency, and completion shares", () => {
    const counters = new OffloadCounters();
    counters.increment("started");
    counters.increment("completed");
    counters.increment("inputBytes", 80_000);
    counters.increment("outputBytes", 8_000);
    counters.increment("estimatedInputTokens", 20_000);
    counters.increment("estimatedOutputTokens", 2_000);
    counters.increment("durationMsTotal", 2_000);
    const derived = deriveOffloadMetrics(counters.snapshot());
    expect(derived.reductionRatio).toBeCloseTo(0.9);
    expect(derived.avgDurationMs).toBe(2_000);
    expect(derived.completionRate).toBe(1);
    expect(derived.estimatedTokensSaved).toBe(18_000);
  });

  it("stays zero-safe with no data", () => {
    const derived = deriveOffloadMetrics(new OffloadCounters().snapshot());
    expect(derived).toEqual({ reductionRatio: 0, avgDurationMs: 0, completionRate: 0, estimatedTokensSaved: 0 });
  });
});
