/**
 * Unit tests for the ResultValidator (SPEC §9.6, §32.1 validation tests).
 */

import { describe, expect, it } from "vitest";

import { validateWorkerOutput } from "../../src/worker/validate.js";
import { makeText, testConfig } from "../fixtures/offload-fixtures.js";

const validation = testConfig().validation;

describe("validateWorkerOutput", () => {
  it("accepts a compact, smaller answer", () => {
    const outcome = validateWorkerOutput("Relevant findings:\n- retry loop in src/auth.ts:120", 50_000, validation);
    expect(outcome).toEqual({ ok: true, text: "Relevant findings:\n- retry loop in src/auth.ts:120" });
  });

  it("rejects empty and whitespace-only answers", () => {
    expect(validateWorkerOutput("", 50_000, validation)).toEqual({ ok: false, reason: "empty-output" });
    expect(validateWorkerOutput("   \n\t", 50_000, validation)).toEqual({ ok: false, reason: "empty-output" });
  });

  it("rejects answers above the configured output cap", () => {
    const outcome = validateWorkerOutput(makeText(30_000), 100_000, validation);
    expect(outcome).toEqual({ ok: false, reason: "output-too-large" });
  });

  it("rejects answers that did not shrink the input by the minimum ratio (SPEC §9.6)", () => {
    const input = makeText(10_000); // 10 240 B
    const almostAsBig = makeText(9_900); // well above 85% of the input
    expect(validateWorkerOutput(almostAsBig, Buffer.byteLength(input), validation)).toEqual({
      ok: false,
      reason: "insufficient-reduction",
    });
  });

  it("skips the reduction check when requireReduction is false", () => {
    const relaxed = testConfig({ validation: { requireReduction: false } }).validation;
    const text = makeText(9_900);
    expect(validateWorkerOutput(text, Buffer.byteLength(text), relaxed)).toEqual({ ok: true, text });
  });

  it("rejects an answer for an empty input when reduction is required", () => {
    expect(validateWorkerOutput("any", 0, validation)).toEqual({ ok: false, reason: "insufficient-reduction" });
  });
});
