/**
 * Log preview: head lines, important pattern lines from the middle, tail
 * lines (SPEC §18). Pattern matching reuses the proven keep-patterns
 * approach with configurable case-insensitive substrings.
 */

import { boundedBlock, formatOmitted } from "./text.js";
import type { PreviewOptions } from "./options.js";

export interface LogPreview {
  readonly body: string;
}

export function previewLog(value: string, options: PreviewOptions): LogPreview {
  const lines = value.split(/\r\n|\r|\n/);
  const headBudget = Math.floor(options.maxChars * 0.4);
  const patternBudget = Math.floor(options.maxChars * 0.25);
  const tailBudget = Math.floor(options.maxChars * 0.25);

  const head = boundedBlock(lines, 0, options.keepHeadLines, headBudget);
  const tailStart = Math.max(head.lineCount, lines.length - options.keepTailLines);
  const tail = boundedBlock(lines, tailStart, lines.length, tailBudget);

  const headEnd = head.lineCount;
  const tailBegin = tail.text.length > 0 ? tailStart : lines.length;
  const middle = collectPatternLines(lines, headEnd, tailBegin, options.keepPatterns, patternBudget);

  const omittedLines = Math.max(0, tailBegin - headEnd - middle.coveredLines);
  const parts: string[] = [];
  if (head.text.length > 0) parts.push(head.text);
  if (middle.text.length > 0) parts.push(middle.text);
  parts.push(`[dsh-cas-results: ${formatOmitted(omittedLines)} lines omitted]`);
  if (tail.text.length > 0) parts.push(tail.text);
  return { body: parts.join("\n\n") };
}

interface MiddleSection {
  readonly text: string;
  readonly coveredLines: number;
}

function collectPatternLines(
  lines: readonly string[],
  from: number,
  to: number,
  patterns: readonly string[],
  budget: number,
): MiddleSection {
  if (patterns.length === 0 || to <= from) return { text: "", coveredLines: 0 };
  const needles = patterns.map((pattern) => pattern.toLowerCase());
  const collected: string[] = [];
  let used = 0;
  let covered = 0;
  for (let index = from; index < to; index += 1) {
    const line = lines[index] ?? "";
    const lower = line.toLowerCase();
    if (!needles.some((needle) => needle.length > 0 && lower.includes(needle))) continue;
    // Keep one line of context after the match; it usually carries the
    // continuation of a stack trace.
    const contextLine = index + 1 < to ? (lines[index + 1] ?? "") : "";
    const block = contextLine === "" ? line : `${line}\n${contextLine}`;
    const cost = block.length + (collected.length > 0 ? 2 : 0);
    if (used + cost > budget) continue;
    collected.push(block);
    used += cost;
    covered += contextLine === "" ? 1 : 2;
    index += contextLine === "" ? 0 : 1;
  }
  if (collected.length === 0) return { text: "", coveredLines: 0 };
  return { text: collected.join("\n\n"), coveredLines: covered };
}
