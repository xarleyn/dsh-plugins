/**
 * Mutation plan assembly (SPEC §16, §20).
 *
 * The plan is the only artifact the mutation layer consumes: candidate,
 * decision, action, rendered replacement text and size accounting, in
 * snapshotted surface order.
 */

import type { SurfaceSnapshot } from "../dsh/surface.js";
import { estimateSavings, type SavingsEstimate } from "./savings.js";
import type { ToolResultCandidate } from "./collect.js";
import type { CandidateFeatures } from "./features.js";
import type { CandidateScores, PruneAction } from "./policy.js";

/** One planned mutation (or deliberate keep). */
export interface PlanItem {
  readonly candidate: ToolResultCandidate;
  readonly features?: CandidateFeatures;
  readonly scores?: CandidateScores;
  readonly action: PruneAction;
  /** Rendered replacement text; `undefined` for KEEP_FULL. */
  readonly replacementText?: string;
  readonly replacementChars: number;
}

/** A complete, validated plan awaiting application. */
export interface JevCompactionPlan {
  readonly surfaceSnapshot: SurfaceSnapshot;
  readonly items: readonly PlanItem[];
  readonly savings: SavingsEstimate;
  readonly mutations: readonly PlanItem[];
}

/**
 * Assemble the plan. Items keep the snapshotted surface order; mutation
 * ordering follows that order at apply time (SPEC §16.1).
 */
export function buildPlan(
  surfaceSnapshot: SurfaceSnapshot,
  items: readonly PlanItem[],
): JevCompactionPlan {
  const savings = estimateSavings(
    items.map((item) => ({
      action: item.action,
      originalChars: item.candidate.originalChars,
      replacementChars: item.replacementChars,
    })),
  );
  const mutations = items.filter((item) => item.action !== "KEEP_FULL");
  return { surfaceSnapshot, items, savings, mutations };
}

/** Seqs the plan intends to replace, in snapshotted surface order. */
export function plannedSeqs(plan: JevCompactionPlan): number[] {
  return plan.mutations.map((item) => item.candidate.surfaceSeq);
}
