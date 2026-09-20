/**
 * Local retention policy (result-shaping SPEC §19).
 *
 * Jev proposes, this module disposes. A run collapses only when the two
 * probabilities are decisively apart: the block must be routine with at least
 * `minClassificationConfidence` certainty *and* dropping it must be
 * unnecessary with the same certainty. Anything else — a mid-range
 * probability, a missing answer, a value outside its range — keeps the lines.
 * Raw probability is never permission.
 */

/** Verdict for one run. */
export type RunVerdict =
  | { readonly decision: "collapse"; readonly reason: "routine" }
  | {
      readonly decision: "keep";
      readonly reason:
        "needed" | "low-confidence" | "missing-answer" | "invalid-answer";
    };

/** The pair of probabilities one run's questions produced. */
export interface RunScores {
  /** Probability the block is routine repetition. */
  readonly routine?: number;
  /** Probability that removing the block materially hurts the next decision. */
  readonly needed?: number;
}

function trusted(value: number | undefined): value is number {
  return (
    value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1
  );
}

/**
 * Collapse only on a decisive pair. `needed` must be at most `1 - confidence`,
 * so the two answers cannot both lean the same way and still authorize a drop.
 */
export function decideRun(
  scores: RunScores,
  minConfidence: number,
): RunVerdict {
  const { routine, needed } = scores;
  if (routine === undefined && needed === undefined) {
    return { decision: "keep", reason: "missing-answer" };
  }
  if (!trusted(routine) || !trusted(needed)) {
    return { decision: "keep", reason: "invalid-answer" };
  }
  const required = Math.min(Math.max(minConfidence, 0.5), 1);
  if (routine >= required && needed <= 1 - required) {
    return { decision: "collapse", reason: "routine" };
  }
  return {
    decision: "keep",
    reason: needed >= required ? "needed" : "low-confidence",
  };
}
