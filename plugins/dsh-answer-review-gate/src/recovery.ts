import type { ReviewInput } from "./types.js";
import { ReviewerFailure } from "./types.js";

/** At most one retry, only for a missing native capture without a real error. */
export function canRecoverCapture(
  attempt: number,
  status: string,
  captured: boolean,
  diagnostic: string | undefined,
): boolean {
  return (
    attempt === 0 &&
    (status === "error" || status === "completed") &&
    !captured &&
    (diagnostic ?? "").trim() === ""
  );
}

export function assertReviewActive(input: ReviewInput): void {
  if (input.signal.aborted)
    throw new ReviewerFailure(
      "reviewer-aborted",
      "the reviewed turn was cancelled",
    );
}

export const CAPTURE_RECOVERY_INSTRUCTION =
  "A previous attempt ended without delivering the required native result. " +
  "Review this same candidate independently and finish by calling structured_output exactly once. " +
  "Text, a verdict heading, and fenced JSON do not deliver the result. " +
  "Keep real objections in the result; do not convert this delivery failure into a factual objection.";
