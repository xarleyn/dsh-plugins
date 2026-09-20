/**
 * Replacement text renderers (SPEC §14).
 *
 * Wording is deliberately neutral: the stub never claims Jev proved the
 * result irrelevant — only that it was pruned from the active model context.
 * Slicing is by Unicode code point, mirroring the harness's own pruner.
 */

import type { ToolResultCandidate } from "../planner/collect.js";

/** Measure text in Unicode code points (not UTF-16 units). */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** Code-point-safe slice. */
function sliceCodePoints(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join("");
}

export const PRUNED_BY = "[dsh-jev-compaction]";

/**
 * KEEP_STUB: a small semantic/replay marker. The original event remains in
 * the session log; the marker says exactly that.
 *
 * When the result had already been reduced by immediate shaping before it was
 * persisted (result-shaping SPEC §26), the stub records two extra facts: the
 * visible content was a reconstruction, and — when one exists — the reference
 * under which the pre-shaping original was archived. The reference is a
 * content hash, never a filesystem path, and it is not a capability: nothing
 * resolves it without a plugin-side lookup.
 */
export function renderStub(
  candidate: ToolResultCandidate,
  reason: string,
): string {
  const lines = [
    PRUNED_BY,
    "Historical tool output pruned from active model context.",
    `tool=${candidate.toolName ?? "unknown"}`,
    `originalChars=${candidate.originalChars}`,
    `reason=${reason}`,
  ];
  if (candidate.alreadyShaped === true) {
    lines.push("previouslyShaped=true");
  }
  if (candidate.archiveRef !== undefined) {
    lines.push(`archivedOriginal=${candidate.archiveRef}`);
  }
  lines.push("The original event remains available in the session log.");
  return lines.join("\n");
}

/**
 * KEEP_TRUNCATED: bounded head plus optional tail around a neutral marker.
 * Useful for logs and command output where rough identity still matters.
 */
export function renderTruncated(
  originalText: string,
  headChars: number,
  tailChars: number,
): string {
  const total = codePointLength(originalText);
  const head = sliceCodePoints(originalText, 0, headChars);
  const tail =
    tailChars > 0
      ? sliceCodePoints(
          originalText,
          Math.max(headChars, total - tailChars),
          total,
        )
      : "";
  const removed = total - codePointLength(head) - codePointLength(tail);
  if (removed <= 0) return originalText;
  const marker = `\u2026 [${PRUNED_BY} pruned ${removed.toLocaleString("en-US")} historical characters] \u2026`;
  const parts: string[] = [];
  if (head.length > 0) parts.push(head);
  parts.push(marker);
  if (tail.length > 0) parts.push(tail);
  return parts.join("\n\n");
}

/** Render the replacement for one action. */
export function renderReplacement(
  candidate: ToolResultCandidate,
  action: "KEEP_TRUNCATED" | "KEEP_STUB",
  headChars: number,
  tailChars: number,
  reason: string,
): string {
  if (action === "KEEP_TRUNCATED") {
    return renderTruncated(candidate.originalText, headChars, tailChars);
  }
  return renderStub(candidate, reason);
}
