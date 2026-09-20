/**
 * Reconstruction (result-shaping SPEC §20, §25).
 *
 * The shaped text is the original line sequence with each collapsed run
 * replaced in place, so ordering is preserved by construction. Markers state
 * exactly what happened — how many adjacent repetitive lines were collapsed —
 * and never claim the removed output was irrelevant or that its content is
 * gone; the plugin only knows the block repeated one shape.
 *
 * The archive marker carries a truncated, content-addressed reference. It is
 * not a path and not a capability: nothing resolves it without a plugin-side
 * lookup the model cannot perform.
 */

import type { LineRun } from "./cluster.js";

/** Every marker this plugin writes into shaped output starts with this. */
export const SHAPING_MARKER_PREFIX = "[dsh-jev-compaction:";

/** Detects a result this plugin has already shaped (idempotence, §26). */
export function isShapedText(text: string): boolean {
  return text.includes(SHAPING_MARKER_PREFIX);
}

const ARCHIVE_REFERENCE_PATTERN =
  /\[dsh-jev-compaction: original archived as (sha256:[0-9a-f]+)\]/u;

/** The archive reference recorded in a previously shaped result, if any. */
export function readArchiveRef(text: string): string | undefined {
  return ARCHIVE_REFERENCE_PATTERN.exec(text)?.[1];
}

/** Marker replacing one collapsed run. Factual: it counts, it does not judge. */
export function collapseMarker(count: number): string {
  return `${SHAPING_MARKER_PREFIX} collapsed ${count.toLocaleString("en-US")} repetitive lines]`;
}

/** Marker naming the archived original. `ref` is a short `sha256:<hex>` value. */
export function archiveMarker(ref: string): string {
  return `${SHAPING_MARKER_PREFIX} original archived as ${ref}]`;
}

export interface ReconstructionInput {
  readonly lines: readonly string[];
  /** Runs to collapse, in output order. */
  readonly collapsed: readonly LineRun[];
  /** Short archive reference to append, when the original was archived. */
  readonly archiveRef?: string;
}

/**
 * Rebuild the text. Runs must be disjoint and in ascending order — they come
 * from `analyzeText`, which guarantees both.
 */
export function reconstruct(input: ReconstructionInput): string {
  const { lines, collapsed } = input;
  if (collapsed.length === 0) return lines.join("\n");
  const parts: string[] = [];
  let cursor = 0;
  for (const run of collapsed) {
    for (; cursor < run.start; cursor += 1) parts.push(lines[cursor]!);
    parts.push(collapseMarker(run.count));
    cursor = run.end;
  }
  for (; cursor < lines.length; cursor += 1) parts.push(lines[cursor]!);
  if (input.archiveRef !== undefined)
    parts.push("", archiveMarker(input.archiveRef));
  return parts.join("\n");
}

/** Characters saved by one collapse, counting the marker's own cost. */
export function runSavings(lines: readonly string[], run: LineRun): number {
  let original = 0;
  for (let index = run.start; index < run.end; index += 1) {
    original += lines[index]!.length + 1;
  }
  return original - (collapseMarker(run.count).length + 1);
}
