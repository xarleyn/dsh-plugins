/**
 * GFM block grammar for the chat renderer: the container and leaf blocks the
 * assistant's answers actually use, parsed here and handed to `render.tsx` as
 * plain data. Text inside a leaf block stays raw Markdown — `parseInline`
 * resolves it at render time — so one block pass feeds every inline consumer.
 *
 * The grammar is deliberately a subset of CommonMark: nested containers and
 * lazy continuation are supported, while the pathological corners (HTML
 * blocks, setext inside lists, link reference definitions spanning lines) stay
 * out. Raw HTML never becomes a block: a tag line is a paragraph whose inline
 * pass leaves the tag as literal text.
 */

/** `#`-through-`######` heading levels. */
export type HeadingDepth = 1 | 2 | 3 | 4 | 5 | 6;

/** Column alignment carried by a table's delimiter row. */
export type TableAlign = "left" | "center" | "right";

/** One list item: its own blocks plus the checkbox a task item declares. */
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
  | { readonly kind: "code"; readonly text: string; readonly lang?: string }
  | { readonly kind: "quote"; readonly blocks: readonly MarkdownBlock[] }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly start: number;
      readonly loose: boolean;
      readonly items: readonly MarkdownListItem[];
    }
  | {
      readonly kind: "table";
      readonly align: readonly TableAlign[];
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly kind: "rule" };

/** A parsed document: its blocks plus the reference targets they resolve. */
export interface ParsedMarkdown {
  readonly blocks: readonly MarkdownBlock[];
  /** Link/image definitions by upper-cased identifier. */
  readonly definitions: ReadonlyMap<string, string>;
}

/** Container depth ceiling: enough for real answers, too low to recurse away.
 * Past it a marker stays literal text — the content is never dropped. */
const MAX_DEPTH = 8;

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/u;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/u;
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/u;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/u;
const LIST_MARKER = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)/u;
const DEFINITION = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*<?([^\s>]+)>?[ \t]*$/u;
const ALIGNMENT_CELL = /^:?-+:?$/u;
const CHECKBOX = /^\[([ xX])\][ \t]+/u;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** True when a line opens a block that ends the paragraph it follows. */
function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    ATX_HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST_MARKER.test(line)
  );
}

/** Split one table row into trimmed cells, honoring escaped pipes. */
export function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim().replace(/\\\|/gu, "|"));
}

/**
 * Does a GFM table start at `index`? The header must carry a pipe and the
 * delimiter row must match it cell for cell — which is also what keeps a
 * setext underline (`---` after a paragraph) out of the table arm.
 */
function tableAlignments(
  lines: readonly string[],
  index: number,
): readonly TableAlign[] | undefined {
  const headerLine = lines[index];
  const delimiter = lines[index + 1];
  if (headerLine === undefined || delimiter === undefined) return undefined;
  if (!headerLine.includes("|")) return undefined;
  const cells = splitTableRow(delimiter);
  if (cells.length === 0 || cells.length !== splitTableRow(headerLine).length) {
    return undefined;
  }
  const alignments: TableAlign[] = [];
  for (const cell of cells) {
    if (!ALIGNMENT_CELL.test(cell)) return undefined;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    alignments.push(left && right ? "center" : right ? "right" : "left");
  }
  return alignments;
}

/** A fence closes on a run of its own marker at least as long as the opener's. */
function closesFence(line: string, marker: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  if (indentOf(line) > 3) return false;
  if (![...trimmed].every((char) => char === marker[0])) return false;
  return trimmed.length >= marker.length;
}

/**
 * Parse a whole document.
 * @param text - Markdown source with any line endings.
 * @returns Blocks plus the definitions the inline pass resolves against.
 */
export function parseMarkdown(text: string): ParsedMarkdown {
  const definitions = new Map<string, string>();
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  return { blocks: parseBlocks(lines, definitions, 0), definitions };
}

/**
 * Parse the blocks of one container (document, quote, or list item).
 * @param lines - Container lines, already de-indented by the caller.
 * @param definitions - Document-wide definition accumulator.
 * @param depth - Container nesting depth.
 * @returns The container's blocks.
 */
export function parseBlocks(
  lines: readonly string[],
  definitions: Map<string, string>,
  depth: number,
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const code: string[] = [];
      const indent = indentOf(line);
      index += 1;
      while (
        index < lines.length &&
        !closesFence(lines[index] ?? "", fence[1] ?? "")
      ) {
        code.push(
          (lines[index] ?? "").slice(
            Math.min(indent, indentOf(lines[index] ?? "")),
          ),
        );
        index += 1;
      }
      if (index < lines.length) index += 1;
      const lang = /^\S+/u.exec(fence[2]?.trim() ?? "")?.[0];
      blocks.push({
        kind: "code",
        text: code.join("\n"),
        ...(lang === undefined ? {} : { lang }),
      });
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: "heading",
        depth: (heading[1] ?? "#").length as HeadingDepth,
        text: (heading[2] ?? "").replace(/[ \t]+#+[ \t]*$/u, "").trim(),
      });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const quote = depth < MAX_DEPTH ? QUOTE.exec(line) : null;
    if (quote !== null) {
      const body: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const inside = QUOTE.exec(current);
        if (inside !== null) {
          body.push(inside[1] ?? "");
          index += 1;
          continue;
        }
        // Lazy continuation: prose directly under a quote stays in the quote.
        if (isBlank(current) || startsBlock(current)) break;
        body.push(current);
        index += 1;
      }
      blocks.push({
        kind: "quote",
        blocks: parseBlocks(body, definitions, depth + 1),
      });
      continue;
    }

    const alignments = tableAlignments(lines, index);
    if (alignments !== undefined && LIST_MARKER.exec(line) === null) {
      const head = splitTableRow(line);
      const rows: string[][] = [];
      let cursor = index + 2;
      while (cursor < lines.length) {
        const row = lines[cursor] ?? "";
        if (isBlank(row) || !row.includes("|") || startsBlock(row)) break;
        rows.push(splitTableRow(row));
        cursor += 1;
      }
      blocks.push({ kind: "table", align: alignments, head, rows });
      index = cursor;
      continue;
    }

    if (depth < MAX_DEPTH && LIST_MARKER.test(line)) {
      const list = parseList(lines, index, definitions, depth);
      blocks.push(list.list);
      index = list.next;
      continue;
    }

    const definition = DEFINITION.exec(line);
    if (definition !== null) {
      const id = (definition[1] ?? "").trim().toUpperCase();
      if (!definitions.has(id)) definitions.set(id, definition[2] ?? "");
      index += 1;
      continue;
    }

    const paragraph = collectParagraph(lines, index);
    blocks.push(paragraph.block);
    index = paragraph.next;
  }
  return blocks;
}

/**
 * Collect a leaf paragraph, promoting it to a setext heading when the line
 * after it is an underline.
 * @param lines - Container lines.
 * @param start - Index of the paragraph's first line.
 * @returns The block and the index after it.
 */
function collectParagraph(
  lines: readonly string[],
  start: number,
): { readonly block: MarkdownBlock; readonly next: number } {
  const text: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isBlank(line)) break;
    if (text.length > 0) {
      const underline = SETEXT_UNDERLINE.exec(line);
      if (underline !== null) {
        return {
          block: {
            kind: "heading",
            depth: (underline[1] ?? "=").startsWith("=") ? 1 : 2,
            text: text.join("\n").trim(),
          },
          next: index + 1,
        };
      }
      if (startsBlock(line)) break;
      if (tableAlignments(lines, index) !== undefined) break;
    }
    text.push(line.trimStart());
    index += 1;
  }
  return {
    block: { kind: "paragraph", text: text.join("\n").trim() },
    next: index,
  };
}

/**
 * Parse one list: sibling items at the same level, their nested blocks
 * recursively parsed.
 * @param lines - Container lines.
 * @param start - Index of the first item's marker.
 * @param definitions - Document-wide definition accumulator.
 * @param depth - Container nesting depth.
 * @returns The list block and the index after its last item.
 */
function parseList(
  lines: readonly string[],
  start: number,
  definitions: Map<string, string>,
  depth: number,
): { readonly list: MarkdownBlock; readonly next: number } {
  const first = LIST_MARKER.exec(lines[start] ?? "");
  const ordered = /^\d/u.test(first?.[2] ?? "-");
  const bullet = first?.[2] ?? "-";
  const delimiter = ordered ? bullet.slice(-1) : bullet;
  const baseIndent = first?.[1]?.length ?? 0;
  const startNumber = ordered ? Number.parseInt(bullet, 10) : 1;
  const items: MarkdownListItem[] = [];
  let loose = false;
  let index = start;

  while (index < lines.length) {
    let blanks = 0;
    while (index < lines.length && isBlank(lines[index] ?? "")) {
      index += 1;
      blanks += 1;
    }
    const marker = LIST_MARKER.exec(lines[index] ?? "");
    if (marker === null) break;
    const token = marker[2] ?? "-";
    const sameKind =
      ordered === /^\d/u.test(token) &&
      (ordered ? token.slice(-1) === delimiter : token === bullet);
    if (!sameKind || (marker[1]?.length ?? 0) > baseIndent + 1) break;
    // A blank line only spreads the list when another item really follows it.
    if (blanks > 0) loose = true;

    const padding = marker[3]?.length ?? 1;
    const markerWidth =
      (marker[1]?.length ?? 0) + token.length + (padding > 4 ? 1 : padding);
    const itemLines: string[] = [(lines[index] ?? "").slice(markerWidth)];
    index += 1;
    let itemSpread = false;

    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (isBlank(current)) {
        let next = index + 1;
        while (next < lines.length && isBlank(lines[next] ?? "")) next += 1;
        const following = lines[next] ?? "";
        if (next >= lines.length || indentOf(following) < markerWidth) break;
        itemLines.push("");
        itemSpread = true;
        index += 1;
        continue;
      }
      if (indentOf(current) >= markerWidth) {
        itemLines.push(current.slice(markerWidth));
        index += 1;
        continue;
      }
      // A lazy continuation line belongs to the item's paragraph; anything
      // that opens a block of its own ends the item instead.
      if (startsBlock(current)) break;
      if (tableAlignments(lines, index) !== undefined) break;
      itemLines.push(current.trimStart());
      index += 1;
    }

    const checkbox = CHECKBOX.exec(itemLines[0] ?? "");
    const task = checkbox !== null;
    if (checkbox !== null) {
      itemLines[0] = (itemLines[0] ?? "").slice(checkbox[0].length);
    }
    const itemBlocks =
      depth >= MAX_DEPTH ? [] : parseBlocks(itemLines, definitions, depth + 1);
    // Only a blank line inside the item spreads it: an item that merely carries
    // a nested list or a fence still renders as a tight item, as GFM says.
    if (itemSpread) loose = true;
    items.push({
      blocks: itemBlocks,
      task,
      checked: (checkbox?.[1] ?? " ").toLowerCase() === "x",
    });
  }

  return {
    list: {
      kind: "list",
      ordered,
      start: startNumber,
      loose,
      items,
    },
    next: index,
  };
}
