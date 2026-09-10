/**
 * ResultValidator (SPEC §9.6).
 *
 * A worker answer reaches the parent only when it is non-empty, bounded, and
 * actually smaller than the original. Everything else falls back to the
 * original tool result — correctness beats token savings (SPEC §9.7).
 */

import { byteLength } from "../utils/text.js";
import type { ResolvedToolOffloadConfig } from "../config.js";

export type WorkerValidationFailure = "empty-output" | "output-too-large" | "insufficient-reduction";

export type WorkerValidation = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: WorkerValidationFailure };

export function validateWorkerOutput(text: string, inputBytes: number, validation: ResolvedToolOffloadConfig["validation"]): WorkerValidation {
  if (text.trim() === "") return { ok: false, reason: "empty-output" };
  const outputBytes = byteLength(text);
  if (outputBytes > validation.maxOutputBytes) return { ok: false, reason: "output-too-large" };
  if (validation.requireReduction) {
    const maxAllowed = inputBytes * (1 - validation.minReductionRatio);
    if (outputBytes > maxAllowed) return { ok: false, reason: "insufficient-reduction" };
  }
  return { ok: true, text };
}
