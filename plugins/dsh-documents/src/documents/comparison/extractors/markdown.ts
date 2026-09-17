/**
 * Markdown and plain-text extractors (§10, §26 P0).
 *
 * These two are the reference implementation of the IR: the whole
 * deterministic pipeline — alignment, token diff, change model, artifact
 * format — is developed and tested against them, because a Markdown pair has
 * no container in the way. They are also genuinely useful on their own: a
 * specification is frequently exchanged as Markdown, and a plain-text revision
 * is what half the world sends when nobody asked for DOCX.
 *
 * Both are line parsers with an explicit rule per construct. Nothing here
 * guesses: a construct the parser does not know becomes a paragraph, which
 * means an unrecognized syntax still shows up in the diff as text rather than
 * disappearing from it.
 */

import {
  CanonicalNodeCollector,
  type StructuredDocumentExtractor,
  type StructuredExtractionInput,
} from "./extractor.js";
import type {
  CanonicalDocument,
  CanonicalExtractionKind,
} from "../canonical/document-ir.js";
import type { DocumentWarning } from "../../types.js";
import { parseFrontMatter } from "../../markdown/frontmatter.js";

const ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/u;
const FENCE_START = /^\s{0,3}(`{3,}|~{3,})\s*(.*)$/u;
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-+)\s*$/u;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/u;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/u;
const BLOCKQUOTE = /^\s{0,3}>\s?(.*)$/u;
const TABLE_DELIMITER = /^\s{0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/u;

export class MarkdownStructuredExtractor implements StructuredDocumentExtractor {
  readonly name = "markdown";

  supports(filename: string): boolean {
    return /\.(?:md|markdown|mdown|mkd)$/iu.test(filename);
  }

  async extract(input: StructuredExtractionInput): Promise<CanonicalDocument> {
    return canonicalFromMarkdown(String(bodyOf(input.bytes)), {
      maxNodes: input.maxNodes,
    });
  }
}

/**
 * IR from Markdown text. Shared with the PDF path, which receives Markdown from
 * a text-extraction backend and then treats it exactly as a Markdown document
 * — the same parser, the same node model, one code path to keep honest.
 */
export function canonicalFromMarkdown(
  markdown: string,
  options: {
    readonly maxNodes: number;
    readonly kind?: CanonicalExtractionKind;
    readonly extractor?: string;
    readonly ocrUsed?: boolean;
    readonly warnings?: readonly DocumentWarning[];
  },
): CanonicalDocument {
  const collector = new CanonicalNodeCollector({ maxNodes: options.maxNodes });
  parseMarkdown(markdown, collector);
  return collector.build(
    options.kind ?? "markdown",
    options.extractor ?? "markdown",
    {
      ...(options.ocrUsed === undefined ? {} : { ocrUsed: options.ocrUsed }),
      ...(options.warnings === undefined ? {} : { warnings: options.warnings }),
    },
  );
}

export class PlainTextStructuredExtractor implements StructuredDocumentExtractor {
  readonly name = "plain-text";

  supports(filename: string): boolean {
    return /\.txt$/iu.test(filename);
  }

  async extract(input: StructuredExtractionInput): Promise<CanonicalDocument> {
    const collector = new CanonicalNodeCollector({ maxNodes: input.maxNodes });
    const lines = splitLines(String(bodyOf(input.bytes)));
    let paragraph = 0;
    for (const line of lines) {
      if (line.trim() === "") continue;
      paragraph += 1;
      collector.add({
        type: "paragraph",
        part: "body",
        rawText: line,
        source: { paragraph, xmlPath: "plain-text" },
      });
    }
    return collector.build("plain-text", this.name);
  }
}

function bodyOf(bytes: Buffer): string {
  return bytes.toString("utf8").replace(/^\uFEFF/u, "");
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/gu, "\n").split("\n");
}

function parseMarkdown(
  source: string,
  collector: CanonicalNodeCollector,
): void {
  const lines = splitLines(parseFrontMatter(source).body);
  let index = 0;
  let paragraph = 0;
  let tableNumber = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const fence = FENCE_START.exec(line);
    if (fence !== null) {
      const language = (fence[2] ?? "").trim();
      const marker = (fence[1] as string)[0] as string;
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const candidate = lines[index] as string;
        const closing = FENCE_START.exec(candidate);
        if (
          closing !== null &&
          (closing[1] as string)[0] === marker &&
          (closing[2] ?? "").trim() === ""
        ) {
          index += 1;
          break;
        }
        body.push(candidate);
        index += 1;
      }
      paragraph += 1;
      collector.add({
        type: "paragraph",
        part: "body",
        rawText: body.join("\n"),
        source: {
          paragraph,
          xmlPath: language === "" ? "fence" : `fence:${language}`,
        },
      });
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading !== null) {
      paragraph += 1;
      collector.add({
        type: "heading",
        part: "body",
        level: (heading[1] as string).length,
        rawText: (heading[2] as string).trim(),
        source: { paragraph },
      });
      index += 1;
      continue;
    }

    const underline = SETEXT_UNDERLINE.exec(lines[index + 1] ?? "");
    if (
      underline !== null &&
      !isBlockStart(line) &&
      (lines[index + 1] ?? "").trim() !== ""
    ) {
      paragraph += 1;
      collector.add({
        type: "heading",
        part: "body",
        level: (underline[1] as string).startsWith("=") ? 1 : 2,
        rawText: line.trim(),
        source: { paragraph },
      });
      index += 2;
      continue;
    }

    const table = readTable(lines, index, tableNumber + 1);
    if (table !== undefined) {
      tableNumber += 1;
      paragraph += 1;
      collector.add({
        type: "table",
        part: "body",
        rawText: table.rows
          .map((row) => row.cells.map((cell) => cell.text).join(" | "))
          .join("\n"),
        source: { paragraph, table: table.tableNumber },
        table: {
          rows: table.rows.map((row, rowIndex) => ({
            row: rowIndex,
            cells: row.cells.map((cell, column) => ({
              column,
              rawText: cell.text,
              source: {
                paragraph,
                table: table.tableNumber,
                row: rowIndex,
                column,
              },
            })),
          })),
        },
      });
      index = table.next;
      continue;
    }

    const quote = BLOCKQUOTE.exec(line);
    if (quote !== null) {
      const body: string[] = [];
      while (index < lines.length) {
        const candidate = BLOCKQUOTE.exec(lines[index] as string);
        if (candidate === null) break;
        body.push(candidate[1] as string);
        index += 1;
      }
      paragraph += 1;
      collector.add({
        type: "paragraph",
        part: "body",
        rawText: body.join("\n"),
        source: { paragraph },
      });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item !== null) {
      const indent = (item[1] as string).replace(/\t/gu, "    ").length;
      const body: string[] = [item[3] as string];
      index += 1;
      while (index < lines.length) {
        const candidate = lines[index] as string;
        if (candidate.trim() === "") break;
        if (isBlockStart(candidate)) break;
        const candidateIndent = (candidate.match(/^\s*/u)?.[0] ?? "").length;
        if (candidateIndent <= indent && LIST_ITEM.test(candidate)) break;
        body.push(candidate.trim());
        index += 1;
      }
      paragraph += 1;
      collector.add({
        type: "list-item",
        part: "body",
        level: Math.floor(indent / 2) + 1,
        rawText: body.join("\n"),
        source: { paragraph },
      });
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      paragraph += 1;
      collector.add({
        type: "paragraph",
        part: "body",
        rawText: line.trim(),
        source: { paragraph, xmlPath: "thematic-break" },
      });
      index += 1;
      continue;
    }

    // A paragraph: every following line that does not start another block.
    const body: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const candidate = lines[index] as string;
      if (candidate.trim() === "" || isBlockStart(candidate)) break;
      if (isTableStart(lines, index)) break;
      body.push(candidate);
      index += 1;
    }
    paragraph += 1;
    collector.add({
      type: "paragraph",
      part: "body",
      rawText: body.join("\n"),
      source: { paragraph },
    });
  }
}

function isBlockStart(line: string): boolean {
  return (
    ATX_HEADING.test(line) ||
    FENCE_START.test(line) ||
    THEMATIC_BREAK.test(line) ||
    LIST_ITEM.test(line) ||
    BLOCKQUOTE.test(line)
  );
}

interface ParsedRow {
  readonly cells: { readonly text: string }[];
}

interface ParsedTable {
  readonly rows: readonly ParsedRow[];
  readonly next: number;
  readonly tableNumber: number;
}

/** Whether these two lines open a GFM pipe table. */
function isTableStart(lines: readonly string[], start: number): boolean {
  const header = lines[start];
  if (header === undefined || !header.includes("|")) return false;
  return TABLE_DELIMITER.test(lines[start + 1] ?? "");
}

/** A GFM pipe table, or `undefined` when these lines are not one. */
function readTable(
  lines: readonly string[],
  start: number,
  tableNumber: number,
): ParsedTable | undefined {
  if (!isTableStart(lines, start)) return undefined;
  const headerCells = splitTableRow(lines[start] as string);
  if (headerCells === undefined) return undefined;
  const rows: ParsedRow[] = [headerCells];
  let index = start + 2;
  while (index < lines.length) {
    const candidate = lines[index] as string;
    if (candidate.trim() === "" || !candidate.includes("|")) break;
    const cells = splitTableRow(candidate);
    if (cells === undefined) break;
    rows.push(cells);
    index += 1;
  }
  return { rows, next: index, tableNumber };
}

function splitTableRow(line: string): ParsedRow | undefined {
  const cells: { text: string }[] = [];
  let current = "";
  let escaped = false;
  for (const character of line.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push({ text: current.trim() });
      current = "";
      continue;
    }
    current += character;
  }
  cells.push({ text: current.trim() });
  // Outer pipes produce an empty first and/or last cell; drop only those.
  if ((cells[0] as { text: string }).text === "") cells.shift();
  if (
    cells.length > 0 &&
    (cells[cells.length - 1] as { text: string }).text === ""
  ) {
    cells.pop();
  }
  return cells.length === 0 ? undefined : { cells };
}
