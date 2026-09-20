/**
 * Analysis of a result's text into collapsible runs (result-shaping SPEC §15,
 * §16).
 *
 * Only *contiguous* lines that share a shape are ever grouped, which is what
 * keeps reconstruction trivially order-preserving: the shaped output is the
 * original line sequence with each collapsed run replaced in place. Scattered
 * identical lines are never merged, because merging them would move evidence
 * away from the context that explains it.
 */

import { isBlank, lineShape } from "./normalize.js";
import { pinnedLines } from "./pins.js";

/** One maximal run of adjacent same-shape lines eligible for collapsing. */
export interface LineRun {
  /** Inclusive index of the first line. */
  readonly start: number;
  /** Exclusive index of the last line. */
  readonly end: number;
  /** How many lines the run covers (`end - start`). */
  readonly count: number;
  /** Shape key shared by every line of the run. */
  readonly shape: string;
  /** First line of the run, verbatim (the classifier's sample). */
  readonly sample: string;
}

/** Result of analyzing one text block. */
export interface TextAnalysis {
  readonly lines: readonly string[];
  readonly shapes: readonly string[];
  readonly pinned: ReadonlySet<number>;
  /** Runs of at least `minRunLines` lines, in output order. */
  readonly runs: readonly LineRun[];
  /** Lines covered by `runs`, as a fraction of the non-blank lines. */
  readonly repetitionRatio: number;
}

/** Split text into lines, dropping a single trailing newline artifact. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/u);
  // A trailing newline is a terminator, not an extra empty line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Analyze text: shapes, pins, and the maximal runs of adjacent same-shape
 * lines that may collapse.
 */
export function analyzeText(
  text: string,
  options: {
    minRunLines: number;
    keepHeadLines: number;
    keepTailLines: number;
  },
): TextAnalysis {
  const lines = splitLines(text);
  const shapes = lines.map((line) => lineShape(line));
  const pinned = pinnedLines(
    lines,
    options.keepHeadLines,
    options.keepTailLines,
  );
  const runs: LineRun[] = [];
  let collapsedLines = 0;
  let nonBlank = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (!isBlank(lines[index]!)) nonBlank += 1;
  }

  let cursor = 0;
  while (cursor < lines.length) {
    const shape = shapes[cursor]!;
    if (isBlank(lines[cursor]!) || pinned.has(cursor) || shape.length === 0) {
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    while (
      end < lines.length &&
      !isBlank(lines[end]!) &&
      !pinned.has(end) &&
      shapes[end] === shape
    ) {
      end += 1;
    }
    const count = end - cursor;
    if (count >= Math.max(2, options.minRunLines)) {
      runs.push({ start: cursor, end, count, shape, sample: lines[cursor]! });
      collapsedLines += count;
    }
    cursor = end;
  }

  return {
    lines,
    shapes,
    pinned,
    runs,
    repetitionRatio: nonBlank === 0 ? 0 : collapsedLines / nonBlank,
  };
}
