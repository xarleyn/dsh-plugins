/**
 * Bounded head/tail preview of generic text (SPEC §18).
 */

import type { PreviewOptions } from "./options.js";

export interface TextPreview {
  readonly body: string;
}

interface TakenBlock {
  readonly text: string;
  /** Number of source lines fully or partially included. */
  readonly count: number;
}

export function previewText(value: string, options: PreviewOptions): TextPreview {
  if (value.length <= options.maxChars) return { body: value };
  const lines = value.split(/\r\n|\r|\n/);

  const head = takeLines(lines, 0, Math.min(options.keepHeadLines, lines.length), Math.floor(options.maxChars * 0.55));
  const tailStart = Math.max(head.count, lines.length - options.keepTailLines);
  const tail = takeLines(lines, tailStart, lines.length, Math.floor(options.maxChars * 0.35));

  const omittedLines = Math.max(0, lines.length - head.count - tail.count);
  const parts: string[] = [];
  if (head.text.length > 0) parts.push(head.text);
  if (omittedLines > 0) parts.push(`[dsh-cas-results: ${formatOmitted(omittedLines)} lines omitted]`);
  if (tail.text.length > 0) parts.push(tail.text);
  return { body: parts.join("\n\n") };
}

/**
 * Collect up to `end - start` whole lines within `maxChars` characters. When
 * the very next line alone exceeds the budget, a partial slice of it is
 * taken so a giant single line still yields a bounded, informative preview.
 */
function takeLines(lines: readonly string[], start: number, end: number, maxChars: number): TakenBlock {
  const collected: string[] = [];
  let used = 0;
  let count = 0;
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? "";
    const cost = line.length + (collected.length > 0 ? 1 : 0);
    if (used + cost <= maxChars) {
      collected.push(line);
      used += cost;
      count += 1;
      continue;
    }
    // Partial line: only fill space that is still left in the budget.
    const remaining = maxChars - used - (collected.length > 0 ? 1 : 0);
    if (remaining > 0 && collected.length === 0) {
      collected.push(`${line.slice(0, remaining)}…`);
      count += 1;
    }
    break;
  }
  return { text: collected.join("\n"), count };
}

export function formatOmitted(lines: number): string {
  return lines.toLocaleString("en-US");
}

export interface BoundedBlock {
  readonly text: string;
  readonly lineCount: number;
}

/** Take up to `limitLines` whole lines and at most `maxChars` characters. */
export function boundedBlock(lines: readonly string[], start: number, end: number, maxChars: number): BoundedBlock {
  const collected: string[] = [];
  let used = 0;
  let count = 0;
  for (let index = start; index < end && count < end - start; index += 1) {
    const line = lines[index] ?? "";
    const cost = line.length + (collected.length > 0 ? 1 : 0);
    if (used + cost > maxChars) break;
    collected.push(line);
    used += cost;
    count += 1;
  }
  return { text: collected.join("\n"), lineCount: count };
}
