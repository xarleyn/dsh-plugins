/**
 * Strict response validation (SPEC §18.4).
 *
 * Any malformed batch fails safe: missing keys, duplicate keys, non-finite
 * or out-of-range probabilities and unknown shapes all reject the batch —
 * a malformed answer can never trigger pruning.
 */

import type { JevAnswers, JevQuestion } from "./types.js";

/** Error thrown for any invalid Jev response body. */
export class JevInvalidResponseError extends Error {
  constructor(message: string) {
    super(`jev-compaction: invalid Jev response: ${message}`);
    this.name = "JevInvalidResponseError";
  }
}

/**
 * Validate one raw HTTP body against the requested questions.
 *
 * @returns the probability map keyed by question name.
 */
export function validateJevResponse(
  rawText: string,
  questions: readonly JevQuestion[],
): JevAnswers {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new JevInvalidResponseError("malformed JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new JevInvalidResponseError("response is not an object");
  }
  const answers = (parsed as Record<string, unknown>).answers;
  if (
    answers === null ||
    typeof answers !== "object" ||
    Array.isArray(answers)
  ) {
    throw new JevInvalidResponseError("response is missing an answers object");
  }
  const record = answers as Record<string, unknown>;
  const validated: JevAnswers = new Map();
  for (const question of questions) {
    const answer = record[question.name];
    if (answer === undefined || answer === null || typeof answer !== "object") {
      throw new JevInvalidResponseError(`missing answer for ${question.name}`);
    }
    const noul = (answer as Record<string, unknown>).noul;
    if (typeof noul !== "number" || !Number.isFinite(noul)) {
      throw new JevInvalidResponseError(
        `non-numeric probability for ${question.name}`,
      );
    }
    if (noul < 0 || noul > 1) {
      throw new JevInvalidResponseError(
        `probability out of range for ${question.name}`,
      );
    }
    validated.set(question.name, noul);
  }
  return validated;
}
