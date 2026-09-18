/**
 * Canonical Document IR (§8, §9).
 *
 * Markdown is an output format, not a representation: comparing two Markdown
 * renderings would make every backend's whitespace and layout habits part of
 * the answer. Instead each input is parsed into this IR — ordered nodes with a
 * heading path, a source position, an exact `rawText` and a `comparisonKey`
 * used only for alignment — and the diff runs over two IRs.
 *
 * The two text fields are the point of the whole design (§9):
 *
 * - `rawText` is what the document actually says. It is what a change reports
 *   as `before`/`after`, and it is never silently normalized;
 * - `comparisonKey` is allowed to fold away representation noise (NBSP,
 *   repeated spaces, line-wrap artifacts, Unicode composition) so that the
 *   same sentence matches itself. It must never fold away meaning: a number, a
 *   currency, a negation, a percentage or a swapped word stays visible in it.
 */

import type { DocumentWarning } from "../../types.js";
import { comparisonKeyOf } from "./normalize.js";

/** Which part of the package a node came from (§5.1 `scope`, §12). */
export type DocumentPart =
  "body" | "header" | "footer" | "footnote" | "comment";

/** Parts in the order a comparison reports them; independent of input order. */
export const DOCUMENT_PART_ORDER: readonly DocumentPart[] = [
  "body",
  "header",
  "footer",
  "footnote",
  "comment",
];

/**
 * Node taxonomy (§8).
 *
 * `type` says what a node *is*; `part` says which part of the package it came
 * from. A paragraph in a header is a paragraph with `part: "header"`, which is
 * what makes headers align with headers and body text with body text. The two
 * exceptions are the units that are leaves by nature: a footnote and a comment
 * are each one node.
 */
export type DocumentNodeType =
  | "heading"
  | "paragraph"
  | "list-item"
  | "table"
  | "table-row"
  | "table-cell"
  | "footnote"
  | "comment";

/** Where a node sits in the source document (§8 `source`). */
export interface NodeSource {
  readonly page?: number;
  readonly paragraph?: number;
  readonly table?: number;
  readonly row?: number;
  readonly column?: number;
  /** Package part the node was read from, e.g. `word/header1.xml`. */
  readonly xmlPath?: string;
}

/** One tracked revision touching a node (§12). */
export interface NodeRevision {
  readonly type: "insert" | "delete";
  readonly author?: string;
  readonly date?: string;
  readonly text?: string;
}

/** A table cell: text plus the coordinates a change reports (§27). */
export interface CanonicalTableCell {
  readonly column: number;
  readonly rawText: string;
  readonly comparisonKey: string;
  readonly source: NodeSource;
}

export interface CanonicalTableRow {
  readonly row: number;
  readonly cells: readonly CanonicalTableCell[];
  /** Cells joined by ` | `, the row's own text for row-level changes. */
  readonly rawText: string;
  readonly comparisonKey: string;
}

export interface CanonicalTable {
  readonly rows: readonly CanonicalTableRow[];
}

export interface CanonicalNode {
  /** Stable within one document: `<part>:<index>`. */
  readonly id: string;
  readonly type: DocumentNodeType;
  readonly part: DocumentPart;
  /** Heading level for `heading`; list nesting level for `list-item`. */
  readonly level?: number;
  /** Heading stack this node sits under, outermost first (§8 `path`). */
  readonly path: readonly string[];
  readonly rawText: string;
  readonly comparisonKey: string;
  readonly source: NodeSource;
  /** Tracked revisions found on this node (§12); absent when there are none. */
  readonly revisions?: readonly NodeRevision[];
  /**
   * Formatting signature. Filled only when `ignoreFormatting` is off — the
   * contract default treats formatting as out of scope, and a signature nobody
   * compares would only cost memory.
   */
  readonly formatting?: string;
  /** Present on `table` nodes. */
  readonly table?: CanonicalTable;
}

/** How a canonical document was produced; drives the quality level (§25). */
export type CanonicalExtractionKind =
  "native-docx" | "markdown" | "plain-text" | "pdf-text" | "pdf-ocr";

/** Extraction quality of one side, before the pair's level is decided. */
export type ExtractionLevel = "high" | "medium" | "low";

export const EXTRACTION_LEVEL_OF: Readonly<
  Record<CanonicalExtractionKind, ExtractionLevel>
> = {
  "native-docx": "high",
  markdown: "high",
  "plain-text": "high",
  "pdf-text": "medium",
  "pdf-ocr": "low",
};

export interface CanonicalDocument {
  readonly kind: CanonicalExtractionKind;
  /** Backend that produced the text, e.g. `native-docx`. */
  readonly extractor: string;
  readonly ocrUsed: boolean;
  readonly nodes: readonly CanonicalNode[];
  readonly counts: {
    readonly nodes: number;
    readonly tables: number;
    readonly headings: number;
    readonly revisions: number;
  };
  readonly warnings: readonly DocumentWarning[];
}

export interface BuildCanonicalDocumentInput {
  readonly kind: CanonicalExtractionKind;
  readonly extractor: string;
  readonly ocrUsed?: boolean;
  readonly nodes: readonly CanonicalNode[];
  readonly warnings?: readonly DocumentWarning[];
}

/**
 * Assemble a document and derive its counts from the nodes it was given: the
 * counts are read by the quality decision and by `summary.json`, so they must
 * never be something a caller typed by hand.
 */
export function buildCanonicalDocument(
  input: BuildCanonicalDocumentInput,
): CanonicalDocument {
  let tables = 0;
  let headings = 0;
  let revisions = 0;
  for (const node of input.nodes) {
    if (node.type === "table") tables += 1;
    if (node.type === "heading") headings += 1;
    revisions += node.revisions?.length ?? 0;
  }
  return {
    kind: input.kind,
    extractor: input.extractor,
    ocrUsed: input.ocrUsed ?? false,
    nodes: input.nodes,
    counts: {
      nodes: input.nodes.length,
      tables,
      headings,
      revisions,
    },
    warnings: input.warnings ?? [],
  };
}

/** Nodes of one part, in document order. */
export function nodesOfPart(
  document: CanonicalDocument,
  part: DocumentPart,
): CanonicalNode[] {
  return document.nodes.filter((node) => node.part === part);
}

/**
 * Deterministic serialization of the IR, written to
 * `normalized/<side>.json` (§22). Field order is fixed here rather than left
 * to `JSON.stringify`, so two runs produce byte-identical files and a
 * regression test can hash them.
 */
export function serializeCanonicalDocument(
  document: CanonicalDocument,
): string {
  const shape = {
    irVersion: 1,
    kind: document.kind,
    extractor: document.extractor,
    ocrUsed: document.ocrUsed,
    counts: document.counts,
    warnings: document.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.backend === undefined ? {} : { backend: warning.backend }),
    })),
    nodes: document.nodes.map((node) => serializeNode(node)),
  };
  return `${JSON.stringify(shape, null, 2)}\n`;
}

function serializeNode(node: CanonicalNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    part: node.part,
    ...(node.level === undefined ? {} : { level: node.level }),
    path: [...node.path],
    rawText: node.rawText,
    comparisonKey: node.comparisonKey,
    source: { ...node.source },
    ...(node.revisions === undefined
      ? {}
      : { revisions: node.revisions.map((revision) => ({ ...revision })) }),
    ...(node.formatting === undefined ? {} : { formatting: node.formatting }),
    ...(node.table === undefined
      ? {}
      : {
          table: {
            rows: node.table.rows.map((row) => ({
              row: row.row,
              rawText: row.rawText,
              comparisonKey: row.comparisonKey,
              cells: row.cells.map((cell) => ({
                column: cell.column,
                rawText: cell.rawText,
                comparisonKey: cell.comparisonKey,
                source: { ...cell.source },
              })),
            })),
          },
        }),
  };
}

/**
 * Key a node by for alignment: its comparison key plus the node type, so a
 * heading never anchors to a paragraph that happens to say the same thing.
 */
export function strongKeyOf(input: {
  readonly type: string;
  readonly comparisonKey: string;
}): string {
  return `${input.type}\u0000${input.comparisonKey}`;
}

/** Re-export so callers of the IR do not reach into `normalize.ts` directly. */
export { comparisonKeyOf };
