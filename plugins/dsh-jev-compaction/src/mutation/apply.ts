/**
 * Plan application (SPEC §16).
 *
 * The durable log is append-only: validate everything first, revalidate the
 * surface immediately before the first append, then land each replacement
 * independently. Already-landed replacements stay durable if a later one
 * fails; there is no rollback and no history rewriting.
 */

import type { Session, SessionSeq } from "@deepseek-ai/dsh-session";
import {
  appendToolResultReplacement,
  isSnapshotFresh,
} from "../dsh/surface.js";
import type { JevCompactionPlan, PlanItem } from "../planner/plan.js";
import { plannedSeqs } from "../planner/plan.js";
import { codePointLength } from "./render.js";

/** Error thrown when the surface drifted while the plan was being produced. */
export class SurfaceChangedError extends Error {
  constructor() {
    super(
      "jev-compaction: session surface changed while the plan was produced; plan discarded",
    );
    this.name = "SurfaceChangedError";
  }
}

/** One landed replacement. */
export interface AppliedEntry {
  readonly originalSeq: SessionSeq;
  readonly replacementSeq: SessionSeq;
  readonly callId: string;
  readonly charsBefore: number;
  readonly charsAfter: number;
}

/** Outcome of one application pass. */
export interface ApplyOutcome {
  /** Landed replacements, in snapshotted surface order. */
  readonly applied: readonly AppliedEntry[];
  /** Defined when a later replacement failed after earlier ones landed. */
  readonly failure?: { readonly item: PlanItem; readonly error: unknown };
}

/**
 * Validate the plan against the live session and apply it. Throws
 * {@link SurfaceChangedError} before the first append when the plan is stale;
 * reports partial completion through {@link ApplyOutcome.failure} when a
 * later append fails after earlier ones landed.
 */
export function applyPlan(
  session: Session,
  plan: JevCompactionPlan,
): ApplyOutcome {
  const planned = plannedSeqs(plan);
  if (!isSnapshotFresh(session, plan.surfaceSnapshot, planned)) {
    throw new SurfaceChangedError();
  }
  const applied: AppliedEntry[] = [];
  for (const item of plan.mutations) {
    try {
      const event = session.eventAt(item.candidate.surfaceSeq);
      if (event === undefined || event.type !== "tool/result") {
        throw new SurfaceChangedError();
      }
      const text = item.replacementText;
      if (text === undefined)
        throw new TypeError(
          "jev-compaction: mutation item without replacement text",
        );
      const replacementSeq = appendToolResultReplacement(session, event, text);
      applied.push({
        originalSeq: item.candidate.surfaceSeq,
        replacementSeq,
        callId: item.candidate.callId,
        charsBefore: item.candidate.originalChars,
        charsAfter: codePointLength(text),
      });
    } catch (error: unknown) {
      if (error instanceof SurfaceChangedError && applied.length === 0)
        throw error;
      return { applied, failure: { item, error } };
    }
  }
  return { applied };
}
