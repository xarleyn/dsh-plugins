import { DEFAULT_THINKING_PHRASES } from "../thinking-phrases.js";

/** Trim an optional string; a blank value collapses to null. */
export function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * Shared numeric guard for operator-tuned limits: the value has to be a safe
 * integer inside [min, max], and every rejection carries the same message.
 */
export function assertIntInRange(
  name: string,
  value: number,
  min: number,
  max: number,
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(
      `dsh-qa-surface: ${name} must be an integer from ${min} to ${max}`,
    );
  }
}

/** Deduplicate and trim the operator's quick questions. */
export function uniqueQuestions(values: readonly string[]): readonly string[] {
  const questions = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  if (questions.some((value) => value.length > 500)) {
    throw new TypeError(
      "dsh-qa-surface: suggested questions must be at most 500 characters",
    );
  }
  return Object.freeze(questions);
}

/**
 * Normalize the operator's phrase list. Unlike quick questions, an empty list
 * cannot mean "hide the control": the running indicator has to say something,
 * so emptiness restores the built-in phrases.
 */
export function uniquePhrases(values: readonly string[]): readonly string[] {
  const phrases = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  if (phrases.length === 0) return DEFAULT_THINKING_PHRASES;
  if (phrases.some((value) => value.length > 120)) {
    throw new TypeError(
      "dsh-qa-surface: thinking phrases must be at most 120 characters",
    );
  }
  return Object.freeze(phrases);
}
