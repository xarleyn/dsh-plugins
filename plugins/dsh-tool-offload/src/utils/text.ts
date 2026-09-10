/**
 * Byte/token measuring and deterministic bounding helpers (SPEC §11, §12.1).
 *
 * All caps operate on UTF-8 byte length. The token estimate is the cheap
 * `characters / 4` heuristic from SPEC §11 — telemetry must keep labeling
 * it as an estimate.
 */

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function estimateTokens(text: string): number {
  return Math.floor(text.length / 4);
}

/**
 * Keep a bounded head of `text` (SPEC §9.3 parent-context cap). The cut is
 * character-based with a byte safety pass, and a short marker records that
 * content was dropped.
 */
export function truncateHead(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  const marker = "\n[…truncated]";
  const budget = Math.max(0, maxBytes - byteLength(marker));
  let cut = text.length;
  while (cut > 0 && byteLength(text.slice(0, cut)) > budget) cut -= Math.ceil(cut / 2);
  return `${text.slice(0, cut)}${marker}`;
}

/**
 * Deterministic head+tail bounding used by the `truncate` fallback
 * (SPEC §9.7): the head carries openers/paths, the tail carries conclusions
 * and error summaries. Never exceeds `maxBytes`.
 */
export function truncateMiddle(text: string, maxBytes: number, headRatio = 0.6): string {
  const total = byteLength(text);
  if (total <= maxBytes) return text;
  const headBudget = Math.max(0, Math.floor(maxBytes * headRatio) - 40);
  const tailBudget = Math.max(0, Math.floor(maxBytes * (1 - headRatio)) - 40);
  const head = cutToBytes(text, headBudget);
  const tail = cutToBytesFromEnd(text, tailBudget);
  const marker = `\n[…${total - byteLength(head) - byteLength(tail)} bytes truncated…]\n`;
  return `${head}${marker}${tail}`;
}

/** Longest prefix of `text` whose UTF-8 size is at most `maxBytes`. */
function cutToBytes(text: string, maxBytes: number): string {
  let cut = text.length;
  while (cut > 0 && byteLength(text.slice(0, cut)) > maxBytes) cut -= Math.ceil(cut / 2);
  return text.slice(0, cut);
}

/** Longest suffix of `text` whose UTF-8 size is at most `maxBytes`. */
function cutToBytesFromEnd(text: string, maxBytes: number): string {
  let cut = 0;
  while (cut < text.length && byteLength(text.slice(cut)) > maxBytes) cut += Math.ceil((text.length - cut) / 2);
  return text.slice(cut);
}

/**
 * Neutralize closing boundary tags inside untrusted data so a tool result
 * cannot break out of `<TOOL_RESULT>` / `<PARENT_TASK>` / `<TOOL_CALL>`
 * payload sections (SPEC §6.3, §32.1 "hostile prompt-injection fixture").
 */
export function sanitizeBoundaryTags(text: string): string {
  return text.replace(/<\/(TOOL_RESULT|PARENT_TASK|TOOL_CALL|OFFLOAD_NOTE)>/gi, "<\\/$1>");
}
