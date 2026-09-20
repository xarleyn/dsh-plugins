/**
 * Eligibility and trigger policy (result-shaping SPEC §11, §12, §27).
 *
 * Everything here is deterministic and cheap: it runs on the tool-execution
 * critical path, before any classification request is paid for. A result must
 * pass the tool policy, the size and shape triggers, and the "somebody already
 * bounded this" checks before the classifier ever sees it.
 */

import type { ResolvedJevCompactionConfig } from "../config.js";
import { PRUNED_BY } from "../mutation/render.js";
import { isShapedText } from "./reconstruct.js";
import type { ShapeSkipReason } from "./metrics.js";

/**
 * Markers left by DSH's own result-bounding layers. Shaping after one of them
 * would fight the built-in behaviour and could rewrite its locator into a
 * normal-looking preview (SPEC §27).
 */
const FOREIGN_MARKERS: readonly string[] = Object.freeze([
  // @deepseek-ai/dsh-spill-policy stores the full result elsewhere and leaves
  // a preview plus this locator line.
  "Full formatted result stored at:",
  // @deepseek-ai/dsh-compaction-tool-result-pruner rewrites the surface.
  "[... tool result middle pruned ...]",
  // Our own historical-compaction stub and truncation markers.
  PRUNED_BY,
]);

/** True when the tool may be shaped: in the allowlist, not in the denylist. */
export function isToolEligible(
  toolName: string,
  config: ResolvedJevCompactionConfig,
): boolean {
  const shaping = config.resultShaping;
  if (shaping.excludeTools.includes(toolName)) return false;
  return shaping.includeTools.includes(toolName);
}

/** True when the text already carries somebody's bounding marker. */
export function carriesForeignMarker(text: string): boolean {
  return FOREIGN_MARKERS.some((marker) => text.includes(marker));
}

/** Inputs of the deterministic trigger check. */
export interface TriggerInput {
  readonly toolName: string;
  readonly isError: boolean;
  readonly text: string;
  readonly lineCount: number;
  readonly repetitionRatio: number;
}

/** Outcome of the trigger check. */
export type TriggerVerdict =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: ShapeSkipReason };

/**
 * Apply the candidate rules in order: enabled, tool allowed, successful
 * result, shapeable text, size and shape trigger, not already bounded. The
 * per-turn budget is checked by the caller, which owns the turn counter.
 */
export function evaluateTrigger(
  input: TriggerInput,
  config: ResolvedJevCompactionConfig,
): TriggerVerdict {
  const shaping = config.resultShaping;
  if (!shaping.enabled) return { eligible: false, reason: "disabled" };
  if (!isToolEligible(input.toolName, config)) {
    return { eligible: false, reason: "tool-not-allowed" };
  }
  if (input.isError && shaping.preserveErrors) {
    return { eligible: false, reason: "error-result" };
  }
  const length = input.text.length;
  if (length === 0) return { eligible: false, reason: "empty-content" };
  if (isShapedText(input.text)) {
    return { eligible: false, reason: "already-shaped" };
  }
  if (carriesForeignMarker(input.text)) {
    return { eligible: false, reason: "already-spilled" };
  }
  if (length < shaping.thresholdChars) {
    return { eligible: false, reason: "too-small" };
  }
  const shapeTriggered =
    input.lineCount >= shaping.minLines ||
    input.repetitionRatio >= shaping.repetitionTriggerRatio ||
    length >= shaping.hardLengthTriggerChars;
  if (!shapeTriggered) return { eligible: false, reason: "not-repetitive" };
  return { eligible: true };
}
