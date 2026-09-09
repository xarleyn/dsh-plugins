/**
 * Unit tests for every fallback mode (SPEC §9.7, §32.1 fallback tests).
 */

import { describe, expect, it } from "vitest";

import { buildFallbackText } from "../../src/fallback/fallback.js";
import { makeText } from "../fixtures/offload-fixtures.js";

describe("buildFallbackText", () => {
  it("returns null for the default original mode", () => {
    expect(buildFallbackText("original", makeText(4_096), "worker failed", 20_000)).toBeNull();
  });

  it("bounds the truncated mode to the byte budget and explains the failure", () => {
    const original = makeText(40_000);
    const text = buildFallbackText("truncate", original, "worker timeout", 4_096);
    expect(text).not.toBeNull();
    expect(Buffer.byteLength(text!, "utf8")).toBeLessThanOrEqual(4_096 + 200);
    expect(text).toContain("worker timeout");
    expect(text).toContain("bytes truncated");
  });

  it("surfaces the failure detail in error mode", () => {
    const text = buildFallbackText("error", makeText(4_096), "provider missing", 20_000);
    expect(text).toContain("provider missing");
    expect(text).toContain("withheld by fallback mode");
  });
});
