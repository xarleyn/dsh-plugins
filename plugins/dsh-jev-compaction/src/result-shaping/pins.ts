/**
 * Deterministic pins (result-shaping SPEC §17).
 *
 * A pin is a line that must survive shaping no matter what the classifier
 * says: the head and the tail of the output, and every line that looks like a
 * conclusion, a failure, or a diagnostic. Pins are heuristic aids, not a
 * guarantee — the classifier is the second signal, and the savings gate is the
 * third.
 *
 * A pinned line splits a repeated run, so a block of progress lines with an
 * error in the middle collapses on both sides of the error and never across
 * it.
 */

import { isBlank } from "./normalize.js";

/**
 * Conclusion, failure and diagnostic markers. Every entry is a phrase a tool
 * emits to say "this is the outcome" — the part a next-step decision usually
 * needs verbatim.
 */
const IMPORTANT_PATTERNS: readonly RegExp[] = Object.freeze([
  // Failures and exceptions.
  /\b(?:error|errors|fail(?:ed|ure|ures|ing)?|fatal|panic|exception|abort(?:ed)?|denied|refused|timeout|timed out)\b/iu,
  // Warnings and deprecations.
  /\b(?:warn(?:ing|ings)?|deprecat(?:ed|ion))\b/iu,
  // Assertions and stack frames.
  /\b(?:assert(?:ion)?(?:error)?|expected|actual|received)\b/iu,
  /^\s+at\s+\S/u,
  /\bCaused by\b/u,
  /\bTraceback\b/u,
  // Diagnostics with a code: error TS2345, E0308, CVE-, etc.
  /\b(?:error|warning)\s+[A-Z]{1,5}\d{2,6}\b/u,
  /\b\d+\s+(?:errors?|warnings?|failures?)\b/iu,
  // Test and suite summaries.
  /\b\d+\s+(?:passed|failed|skipped|pending|failing|passing)\b/iu,
  /\b(?:tests?|suites?|specs?)\b[\s\S]{0,24}\b(?:passed|failed|ran)\b/iu,
  // Command outcome and exit status.
  /\bexit(?:ed|ing)?\b[^\n]{0,16}\b(?:code|status)\b/iu,
  /\bexit\s+\d+\b/iu,
  /\bcommand\s+(?:not\s+found|failed)\b/iu,
  // Package-manager and build summaries.
  /^(?:added|removed|changed|updated|installed|audited|built|compiled|finished|done)\b/iu,
  /\bpackages?\s+in\s+\d/iu,
  // Diff and patch headers, should a diff ever become shapeable.
  /^(?:\+\+\+|---)\s\S/u,
  /^@@\s/u,
]);

/**
 * Indices that must never be collapsed: the configured head and tail, and any
 * line matching an importance marker. Blank lines are pinned too — they are
 * cheap and they carry the output's own segmentation.
 */
export function pinnedLines(
  lines: readonly string[],
  keepHeadLines: number,
  keepTailLines: number,
): Set<number> {
  const pinned = new Set<number>();
  const head = Math.max(0, keepHeadLines);
  const tail = Math.max(0, keepTailLines);
  for (let index = 0; index < Math.min(head, lines.length); index += 1) {
    pinned.add(index);
  }
  for (
    let index = Math.max(0, lines.length - tail);
    index < lines.length;
    index += 1
  ) {
    pinned.add(index);
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (isBlank(line) || matchesImportant(line)) pinned.add(index);
  }
  return pinned;
}

/** True when a line carries a conclusion, failure or diagnostic marker. */
export function matchesImportant(line: string): boolean {
  for (const pattern of IMPORTANT_PATTERNS) {
    if (pattern.test(line)) return true;
  }
  return false;
}
