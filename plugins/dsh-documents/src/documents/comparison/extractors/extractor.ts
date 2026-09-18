/**
 * Structured extraction: bytes in, canonical IR out (§10).
 *
 * Every format the comparison accepts has an extractor that answers two
 * questions about a file — do you handle this, and what does it say — and the
 * pipeline never looks past that interface. The four implementations differ in
 * exactly one respect that matters to a reader: how much structure survives
 * the trip. A DOCX extractor reads the package itself and keeps paragraphs,
 * tables, numbering, headers and tracked revisions; a PDF extractor can only
 * ask a text-extraction backend what the page said, and says so in its quality
 * level.
 *
 * Node identity is assigned here and nowhere else. `CanonicalNodeCollector`
 * stamps ids, keeps the heading stack that becomes each node's `path`, and
 * counts the nodes so a hostile document is refused before the diff ever sees
 * it.
 */

import type {
  CanonicalDocument,
  CanonicalExtractionKind,
  CanonicalNode,
  CanonicalTableCell,
  CanonicalTableRow,
  DocumentNodeType,
  DocumentPart,
  NodeRevision,
  NodeSource,
} from "../canonical/document-ir.js";
import { buildCanonicalDocument } from "../canonical/document-ir.js";
import { comparisonKeyOf } from "../canonical/normalize.js";
import { DocumentError } from "../../errors.js";
import type { DocumentWarning } from "../../types.js";

/** What an extractor needs to know about the file it was handed. */
export interface StructuredExtractionInput {
  /** File name, used for format hints and for the side's display name. */
  readonly filename: string;
  /**
   * Where those bytes live. Native extractors never need it; a PDF extractor
   * hands the path to the configured text-extraction backend, which reads the
   * file itself and has no way to accept a buffer.
   */
  readonly inputPath: string;
  readonly bytes: Buffer;
  /** When true, formatting signatures are not collected (§5.1). */
  readonly ignoreFormatting: boolean;
  /** Node budget; exceeding it fails the comparison (§30 `maxNodes`). */
  readonly maxNodes: number;
  /**
   * Budget for the *uncompressed* bytes of a container's parts. A DOCX input
   * capped at 50 MiB can still hold gigabytes of XML once inflated, so the
   * package reader counts what it decompresses and refuses to go past this.
   */
  readonly maxUncompressedBytes: number;
  readonly signal?: AbortSignal;
}

export interface StructuredDocumentExtractor {
  readonly name: string;
  supports(filename: string): boolean;
  extract(input: StructuredExtractionInput): Promise<CanonicalDocument>;
}

export interface NodeDraft {
  readonly type: DocumentNodeType;
  readonly part: DocumentPart;
  readonly rawText: string;
  readonly source: NodeSource;
  readonly level?: number;
  readonly revisions?: readonly NodeRevision[];
  readonly formatting?: string;
  readonly table?: {
    readonly rows: readonly {
      readonly row: number;
      readonly cells: readonly {
        readonly column: number;
        readonly rawText: string;
        readonly source: NodeSource;
      }[];
    }[];
  };
}

/**
 * Builds canonical nodes: assigns ids and heading paths, applies the node
 * budget, and derives every comparison key from the text it was given.
 */
export class CanonicalNodeCollector {
  private readonly nodes: CanonicalNode[] = [];
  private readonly headingStacks = new Map<
    DocumentPart,
    { readonly level: number; readonly text: string }[]
  >();
  private readonly maxNodes: number;

  constructor(options: { readonly maxNodes: number }) {
    this.maxNodes = options.maxNodes;
  }

  /** Node budget reached; the caller turns this into `COMPARE_TOO_MANY_NODES`. */
  get overflowing(): boolean {
    return this.nodes.length >= this.maxNodes;
  }

  add(draft: NodeDraft): void {
    if (this.nodes.length >= this.maxNodes) {
      throw new DocumentError(
        "COMPARE_TOO_MANY_NODES",
        `the document has more than ${this.maxNodes} structural nodes`,
        { details: { maxNodes: this.maxNodes } },
      );
    }
    const part = draft.part;
    const stack = this.headingStacks.get(part) ?? [];
    const isHeading = draft.type === "heading";
    if (isHeading) {
      const level = draft.level ?? 1;
      while (
        stack.length > 0 &&
        (stack[stack.length - 1] as { level: number }).level >= level
      ) {
        stack.pop();
      }
    }
    // A heading's own path is its ancestors; a body node's is every heading
    // above it, which is the section a reader would name in a review comment.
    const path = stack.map((entry) => entry.text);
    if (isHeading) stack.push({ level: draft.level ?? 1, text: draft.rawText });
    this.headingStacks.set(part, stack);

    const rawText = draft.rawText;
    const index = this.nodes.length;
    this.nodes.push({
      id: `${part}:${index}`,
      type: draft.type,
      part,
      ...(draft.level === undefined ? {} : { level: draft.level }),
      path,
      rawText,
      comparisonKey: comparisonKeyOf(rawText),
      source: draft.source,
      ...(draft.revisions === undefined || draft.revisions.length === 0
        ? {}
        : { revisions: draft.revisions }),
      ...(draft.formatting === undefined || draft.formatting === ""
        ? {}
        : { formatting: draft.formatting }),
      ...(draft.table === undefined
        ? {}
        : { table: buildTable(draft.table.rows) }),
    });
  }

  build(
    kind: CanonicalExtractionKind,
    extractor: string,
    options?: {
      readonly ocrUsed?: boolean;
      readonly warnings?: readonly DocumentWarning[];
    },
  ): CanonicalDocument {
    return buildCanonicalDocument({
      kind,
      extractor,
      ...(options?.ocrUsed === undefined ? {} : { ocrUsed: options.ocrUsed }),
      nodes: this.nodes,
      ...(options?.warnings === undefined
        ? {}
        : { warnings: options.warnings }),
    });
  }
}

function buildTable(
  rows: readonly {
    readonly row: number;
    readonly cells: readonly {
      readonly column: number;
      readonly rawText: string;
      readonly source: NodeSource;
    }[];
  }[],
): { readonly rows: readonly CanonicalTableRow[] } {
  return {
    rows: rows.map((row) => {
      const cells: CanonicalTableCell[] = row.cells.map((cell) => ({
        column: cell.column,
        rawText: cell.rawText,
        comparisonKey: comparisonKeyOf(cell.rawText),
        source: cell.source,
      }));
      const rawText = cells.map((cell) => cell.rawText).join(" | ");
      return {
        row: row.row,
        cells,
        rawText,
        comparisonKey: comparisonKeyOf(rawText),
      };
    }),
  };
}

/** Parse failure of a container that claims to be a supported format. */
export function parseFailure(
  message: string,
  details?: Record<string, unknown>,
): DocumentError {
  return new DocumentError(
    "COMPARE_PARSE_FAILED",
    message,
    details === undefined ? {} : { details },
  );
}
