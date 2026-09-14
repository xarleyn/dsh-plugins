/**
 * Markdown normalization for extracted documents (§16).
 *
 * The layer is deliberately conservative: it removes artifacts a converter
 * reliably produces (platform line endings, non-breaking spaces, page-number
 * lines, a running head repeated on every page) and never touches meaning.
 * Guessing missing content is explicitly out of scope, and an LLM pass is not
 * part of this stage at all — a document is never sent to a model to make its
 * Markdown nicer.
 */

import type { DocumentWarning } from "../types.js";

export interface NormalizeOptions {
  /** Drop standalone page-number lines (`12`, `- 12 -`, `Page 12`). */
  readonly stripPageNumbers?: boolean;
  /** Drop short lines repeated on three or more pages. */
  readonly stripRunningHeads?: boolean;
}

export interface NormalizeResult {
  readonly markdown: string;
  readonly warnings: readonly DocumentWarning[];
}

const PAGE_NUMBER_LINE =
  /^[ \t]*(?:[-–—|]\s*)?(?:page|стр\.?|страница)?\s*\d{1,4}\s*(?:[-–—|])?[ \t]*$/iu;
const BULLET_SUBSTITUTES = /^([ \t]*)[•▪◦‣·]([ \t]+)/u;
const RUNNING_HEAD_MAX_CHARS = 80;
const RUNNING_HEAD_MIN_REPEATS = 3;

function collapseBlankRuns(lines: readonly string[]): string[] {
  const output: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blanks += 1;
      if (blanks > 1) continue;
      output.push("");
      continue;
    }
    blanks = 0;
    output.push(line);
  }
  while (output.length > 0 && output[output.length - 1] === "") output.pop();
  return output;
}

function stripRunningHeads(lines: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.length > RUNNING_HEAD_MAX_CHARS) continue;
    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith("|") ||
      trimmed.startsWith(">")
    )
      continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  const repeated = new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= RUNNING_HEAD_MIN_REPEATS)
      .map(([line]) => line),
  );
  if (repeated.size === 0) return [...lines];
  return lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.length > RUNNING_HEAD_MAX_CHARS) return true;
    return !repeated.has(trimmed);
  });
}

/** Normalize extracted Markdown; returns the text and what was changed. */
export function normalizeExtractedMarkdown(
  markdown: string,
  options: NormalizeOptions = {},
): NormalizeResult {
  const warnings: DocumentWarning[] = [];
  let text = markdown
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\u00A0/gu, " ")
    .replace(/[\u200B-\u200D\u2060]/gu, "");

  const rawLines = text.split("\n");
  let lines = rawLines.map((line) => line.replace(/\s+$/u, ""));

  const bulletFix = lines.map((line) =>
    line.replace(BULLET_SUBSTITUTES, "$1- "),
  );
  if (bulletFix.some((line, index) => line !== lines[index])) {
    lines = bulletFix;
  }

  const beforeHeadStrip = lines.length;
  if (options.stripRunningHeads ?? true) {
    lines = stripRunningHeads(lines);
    if (lines.length < beforeHeadStrip) {
      warnings.push({
        code: "TABLE_EXTRACTION_DEGRADED",
        message:
          "lines repeated across pages were removed as running heads or footers",
        details: { removed: beforeHeadStrip - lines.length },
      });
    }
  }

  if (options.stripPageNumbers ?? true) {
    const filtered = lines.filter(
      (line, index) =>
        !(
          PAGE_NUMBER_LINE.test(line) &&
          (lines[index - 1] ?? "").trim() === "" &&
          (lines[index + 1] ?? "").trim() === ""
        ),
    );
    if (filtered.length < lines.length) {
      warnings.push({
        code: "TABLE_EXTRACTION_DEGRADED",
        message: "standalone page-number lines were removed",
        details: { removed: lines.length - filtered.length },
      });
    }
    lines = filtered;
  }

  lines = collapseBlankRuns(lines);
  text = `${lines.join("\n")}\n`;
  return { markdown: text, warnings };
}

/** Count Markdown structure for `document_inspect` on Markdown inputs. */
export function markdownStructure(markdown: string): {
  headings: number;
  tables: number;
  images: number;
} {
  const headings = markdown
    .split("\n")
    .filter((line) => /^#{1,6}\s+\S/u.test(line)).length;
  return {
    headings,
    images: (markdown.match(/!\[[^\]]*\]\([^)]*\)/gu) ?? []).length,
    tables: markdown
      .split(/\n{2,}/u)
      .filter((block) => /^\|.*\|$/mu.test(block) && /\|\s*-{2,}/u.test(block))
      .length,
  };
}
