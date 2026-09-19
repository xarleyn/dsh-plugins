/**
 * Decision policy (SPEC §13): Jev proposes, local policy disposes.
 *
 * Probabilities come from the (already validated) backend answers; the
 * action is derived deterministically here. Pinned candidates never reach
 * this module.
 */

import type { ResolvedJevCompactionConfig } from "../config.js";

/** Mutation actions (SPEC §14). */
export type PruneAction = "KEEP_FULL" | "KEEP_TRUNCATED" | "KEEP_STUB";

/** Validated per-candidate answers. */
export interface CandidateScores {
  /** Probability the result's substantive contents are still needed. */
  needContents: number;
  /** Probability the result must stay verbatim (optional dimension). */
  needVerbatim?: number;
}

/**
 * Convert validated probabilities into a deterministic action.
 *
 * - `needContents >= fullThreshold` → full;
 * - `needContents >= truncateThreshold` → truncated, unless verbatim is
 *   asked and clearly unwanted (`needVerbatim < truncateThreshold`), which
 *   downgrades to a stub;
 * - otherwise → stub.
 */
export function decideAction(
  scores: CandidateScores,
  config: ResolvedJevCompactionConfig,
): PruneAction {
  if (scores.needContents >= config.decisions.fullThreshold) return "KEEP_FULL";
  if (scores.needContents >= config.decisions.truncateThreshold) {
    if (
      scores.needVerbatim !== undefined &&
      scores.needVerbatim < config.decisions.truncateThreshold
    ) {
      return "KEEP_STUB";
    }
    return "KEEP_TRUNCATED";
  }
  return "KEEP_STUB";
}
