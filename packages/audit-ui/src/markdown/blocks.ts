/**
 * GFM block grammar for audit reports.
 *
 * Deliberately a subset of CommonMark: the container and leaf blocks a report
 * actually uses, parsed into plain data and rendered elsewhere. Two properties
 * matter more than completeness:
 *
 * - **Raw HTML never becomes a block.** A tag line is a paragraph, and the
 *   inline pass leaves the tag as literal text (SPEC §62). There is no HTML
 *   path to disable because none exists.
 * - **Nothing is dropped.** A construct the grammar does not recognise stays
 *   as text in a paragraph, so an unexpected report still shows its content.
 */

/** `#`-through-`######` heading levels. */
export type HeadingDepth = 1 | 2 | 3 | 4 | 5 | 6;

/** Column alignment from a table's delimiter row. */
export type TableAlign = "left" | "center" | "right";

/** One list item: its own blocks, plus the checkbox a task item declares. */
export interface MarkdownListItem {
  readonly blocks: readonly MarkdownBlock[];
  readonly task: boolean;
  readonly checked: boolean;
}

/** A block-level node; `text` fields hold raw inline Markdown. */
export type MarkdownBlock =
  | { readonly kind: "paragraph"; readonly text: string }
  | {
      readonly kind: "heading";
      readonly depth: HeadingDepth;
      readonly text: string;
    }
  | { readonly kind: "code"; readonly text: string; readonly lang: string }
  | { readonly kind: "quote"; readonly blocks: readonly MarkdownBlock[] }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly start: number;
      readonly items: readonly MarkdownListItem[];
    }
  | {
      readonly kind: "table";
      readonly align: readonly TableAlign[];
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly kind: "rule" };

/** Container depth ceiling; past it a construct stays literal text. */
const MAX_DEPTH = 6;

const HEADING = /^(?<hashes>#{1,6})\s+(?<text>.*)$/u;
const FENCE = /^(?<fence>```+|~~~+)\s*(?<lang>[^\s`]*)\s*$/u;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/u;
const BULLET = /^(?<indent> *)(?<marker>[-*+])\s+(?<rest>.*)$/u;
const ORDERED = /^(?<indent> *)(?<marker>\d{1,9})[.)]\s+(?<rest>.*)$/u;
const QUOTE = /^ {0,3}>\s?(?<rest>.*)$/u;
const TASK = /^\[(?<mark>[ xX])\]\s+(?<rest>.*)$/u;

/** Split a pipe row into cells, honouring `\|` escapes. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char ?? "";
  }
  cells.push(current.trim());
  return cells;
}

/** Parse a delimiter row into column alignments, or `null` when it is not one. */
function parseDelimiter(line: string): TableAlign[] | null {
  const cells = splitRow(line);
  if (cells.length === 0) return null;
  const aligns: TableAlign[] = [];
  for (const cell of cells) {
    if (!/^:?-{1,}:?$/u.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    aligns.push(left && right ? "center" : right ? "right" : "left");
  }
  return aligns;
}

/** `true` when the line opens a table (a pipe row above a delimiter row). */
function startsTable(lines: readonly string[], index: number): boolean {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (header === undefined || delimiter === undefined) return false;
  if (!header.includes("|")) return false;
  const aligns = parseDelimiter(delimiter);
  if (aligns === null) return false;
  return splitRow(header).length === aligns.length;
}

/** Count the leading spaces that decide list nesting. */
function indentOf(line: string): number {
  const match = /^(?<spaces> *)/u.exec(line);
  const spaces = match?.groups?.spaces ?? "";
  return spaces.replace(/\t/gu, "    ").length;
}

/**
 * Parse a document into blocks.
 *
 * @param source - the report's Markdown text.
 */
export function parseBlocks(source: string): readonly MarkdownBlock[] {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  return parseRange(lines, 0, lines.length, 0).blocks;
}

interface RangeResult {
  readonly blocks: MarkdownBlock[];
  readonly next: number;
}

/** Parse `lines[start, end)`, stopping at a line that belongs to the parent. */
function parseRange(
  lines: readonly string[],
  start: number,
  end: number,
  depth: number,
): RangeResult {
  const blocks: MarkdownBlock[] = [];
  let index = start;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join("\n").trim() });
    paragraph = [];
  };

  while (index < end) {
    const line = lines[index] ?? "";

    if (line.trim().length === 0) {
      flushParagraph();
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      flushParagraph();
      const marker = fence.groups?.fence ?? "```";
      const lang = fence.groups?.lang ?? "";
      const body: string[] = [];
      index += 1;
      let closed = false;
      while (index < end) {
        const candidate = lines[index] ?? "";
        if (candidate.trimEnd().startsWith(marker.slice(0, 3))) {
          index += 1;
          closed = true;
          break;
        }
        body.push(candidate);
        index += 1;
      }
      // An unclosed fence ends on the document's final newline, which is a
      // separator rather than content. A closed one never sees it.
      if (!closed && body[body.length - 1] === "") body.pop();
      blocks.push({ kind: "code", text: body.join("\n"), lang });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushParagraph();
      const hashes = heading.groups?.hashes ?? "#";
      blocks.push({
        kind: "heading",
        depth: Math.min(hashes.length, 6) as HeadingDepth,
        text: heading.groups?.text ?? "",
      });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (startsTable(lines, index)) {
      flushParagraph();
      const head = splitRow(line);
      const align = parseDelimiter(lines[index + 1] ?? "") ?? [];
      const rows: string[][] = [];
      index += 2;
      while (index < end && (lines[index] ?? "").includes("|")) {
        const row = splitRow(lines[index] ?? "");
        if (row.length === 0 || row.every((cell) => cell === "")) break;
        rows.push(row);
        index += 1;
      }
      blocks.push({ kind: "table", align, head, rows });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote !== null) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < end) {
        const candidate = QUOTE.exec(lines[index] ?? "");
        if (candidate === null) {
          // A lazy continuation line belongs to the quote.
          if (
            quoted.length > 0 &&
            (lines[index] ?? "").trim().length > 0 &&
            !startsBlock(lines[index] ?? "")
          ) {
            quoted.push(lines[index] ?? "");
            index += 1;
            continue;
          }
          break;
        }
        quoted.push(candidate.groups?.rest ?? "");
        index += 1;
      }
      blocks.push({
        kind: "quote",
        blocks:
          depth >= MAX_DEPTH
            ? [{ kind: "paragraph", text: quoted.join("\n") }]
            : parseRange(quoted, 0, quoted.length, depth + 1).blocks,
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet !== null || ordered !== null) {
      flushParagraph();
      const baseIndent = indentOf(line);
      const isOrdered = ordered !== null;
      const firstStart = Number.parseInt(ordered?.groups?.marker ?? "1", 10);
      const items: MarkdownListItem[] = [];
      const marker = isOrdered ? ORDERED : BULLET;

      while (index < end) {
        const candidate = lines[index] ?? "";
        const match = marker.exec(candidate);
        if (match === null || indentOf(candidate) !== baseIndent) break;
        const rest = match.groups?.rest ?? "";
        const task = TASK.exec(rest);
        const body: string[] = [task?.groups?.rest ?? rest];
        index += 1;
        while (index < end) {
          const continuation = lines[index] ?? "";
          if (continuation.trim().length === 0) {
            // A blank line ends a tight item unless the next line is indented.
            const following = lines[index + 1] ?? "";
            if (
              following.trim().length === 0 ||
              indentOf(following) <= baseIndent
            ) {
              break;
            }
            body.push("");
            index += 1;
            continue;
          }
          if (
            indentOf(continuation) > baseIndent ||
            marker.exec(continuation) === null
          ) {
            if (
              startsBlock(continuation) &&
              indentOf(continuation) <= baseIndent
            ) {
              break;
            }
            body.push(
              continuation.slice(
                Math.min(baseIndent + 2, indentOf(continuation)),
              ),
            );
            index += 1;
            continue;
          }
          break;
        }
        items.push({
          blocks:
            depth >= MAX_DEPTH
              ? [{ kind: "paragraph", text: body.join("\n").trim() }]
              : parseRange(body, 0, body.length, depth + 1).blocks,
          task: task !== null,
          checked: task?.groups?.mark === "x" || task?.groups?.mark === "X",
        });
      }

      blocks.push({
        kind: "list",
        ordered: isOrdered,
        start: Number.isFinite(firstStart) ? firstStart : 1,
        items,
      });
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return { blocks, next: index };
}

/** `true` when the line opens any block, which ends a lazy continuation. */
function startsBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    FENCE.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line)
  );
}
