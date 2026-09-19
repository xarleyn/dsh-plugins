/**
 * Minimum savings gate (SPEC §20): do not rewrite dozens of durable events
 * to save trivial context. The estimate uses Unicode code points, matching
 * the mutation renderer's measurement.
 */

import type { ResolvedJevCompactionConfig } from "../config.js";
import type { PruneAction } from "./policy.js";

/** One planned item's size accounting. */
export interface PlannedItemSizes {
  readonly action: PruneAction;
  readonly originalChars: number;
  readonly replacementChars: number;
}

/** Estimated savings of one plan. */
export interface SavingsEstimate {
  readonly charsSaved: number;
  readonly ratio: number;
}

export function estimateSavings(
  items: readonly PlannedItemSizes[],
): SavingsEstimate {
  let original = 0;
  let replacement = 0;
  for (const item of items) {
    if (item.action === "KEEP_FULL") continue;
    original += item.originalChars;
    replacement += item.replacementChars;
  }
  const charsSaved = Math.max(0, original - replacement);
  const ratio = original > 0 ? charsSaved / original : 0;
  return { charsSaved, ratio };
}

/**
 * The gate passes when either configured threshold is met. Manual runs and
 * dry-runs bypass this gate at the caller (the plan is always shown).
 */
export function meetsSavingsGate(
  estimate: SavingsEstimate,
  config: ResolvedJevCompactionConfig,
): boolean {
  if (
    config.pruning.minSavingsChars <= 0 &&
    config.pruning.minSavingsRatio <= 0
  )
    return true;
  return (
    estimate.charsSaved >= config.pruning.minSavingsChars ||
    estimate.ratio >= config.pruning.minSavingsRatio
  );
}
