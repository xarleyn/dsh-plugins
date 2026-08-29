import { describe, expect, it } from "vitest";
import { deriveUsage, normalizeUsage } from "../src/host/usage.js";

describe("usage math", () => {
  it("keeps disjoint buckets and sums effective input only", () => {
    const usage = normalizeUsage({
      inputTokens: 10,
      outputTokens: 7,
      cacheReadTokens: 20,
      cacheWriteTokens: 3,
      reasoningTokens: 2,
    });
    expect(deriveUsage(usage)).toEqual({ effectiveInputTokens: 33 });
    expect(usage.outputTokens).toBe(7);
    expect(usage.reasoningTokens).toBe(2);
  });

  it("normalizes missing cache fields to zero", () => {
    expect(normalizeUsage({ inputTokens: 4, outputTokens: 1 })).toEqual({
      inputTokens: 4,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });
});
