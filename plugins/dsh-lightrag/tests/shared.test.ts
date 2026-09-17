/**
 * Byte-budget helpers (SPEC §4.3): the answer cap and the insert cap are both
 * expressed in bytes, and a cut must never leave half a UTF-8 sequence behind.
 */

import { describe, expect, it } from "vitest";

import { byteLength, truncateToBytes } from "../src/tools/shared.js";

describe("byteLength", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(byteLength("")).toBe(0);
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("é")).toBe(2);
    expect(byteLength("привет")).toBe(12);
    expect(byteLength("🚀")).toBe(4);
  });
});

describe("truncateToBytes", () => {
  it("passes a text inside the budget through untouched", () => {
    expect(truncateToBytes("short", 1_024)).toEqual({
      text: "short",
      truncated: false,
    });
    expect(truncateToBytes("", 1)).toEqual({ text: "", truncated: false });
    // Exactly at the budget is inside it.
    const exact = "x".repeat(10);
    expect(truncateToBytes(exact, 10).truncated).toBe(false);
  });

  it("cuts above the budget and marks the cut", () => {
    const result = truncateToBytes("x".repeat(100), 10);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("truncated at 10 bytes");
    expect(result.text.startsWith("x".repeat(10))).toBe(true);
  });

  it("never leaves a half-written character at the cut", () => {
    // Each character is three bytes, so a 10-byte budget lands mid-character.
    const result = truncateToBytes("日本語".repeat(10), 10);
    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain("\uFFFD");
    expect(result.text.startsWith("日本語")).toBe(true);
  });

  it("keeps the result bounded by the budget plus the marker", () => {
    const result = truncateToBytes("é".repeat(1_000), 1_024);
    expect(byteLength(result.text)).toBeLessThanOrEqual(
      1_024 + byteLength("\n\n[dsh-lightrag: answer truncated at 1024 bytes]"),
    );
  });
});
