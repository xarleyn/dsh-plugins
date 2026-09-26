/**
 * Seeded pseudo-random input for the comparison roundtrip and property tests
 * (#422, the test remainder of #296 item 1).
 *
 * The generator is hand-rolled on purpose: a comparison is only worth testing
 * against the shapes a real document can produce, and a fixed seed makes every
 * failure reproducible. No new dependency, and nothing that depends on the
 * clock or on `Math.random`.
 */

import { CanonicalNodeCollector } from "../src/documents/comparison/extractors/extractor.js";
import { strongKeyOf } from "../src/documents/comparison/canonical/document-ir.js";
import type {
  CanonicalDocument,
  CanonicalExtractionKind,
  DocumentNodeType,
  DocumentPart,
  NodeRevision,
  NodeSource,
} from "../src/documents/comparison/canonical/document-ir.js";
import {
  CHANGE_KINDS,
  CHANGE_SIGNALS,
  type ChangeKind,
  type ChangeLocation,
  type ChangeSignal,
  type DiffSpan,
  type DocumentChange,
} from "../src/documents/comparison/types.js";
import type {
  DocumentWarning,
  DocumentWarningCode,
} from "../src/documents/types.js";

/** Node budget of a generated document; far below the real one on purpose. */
const MAX_NODES = 200;

/** Parts in the order the diff walks them. */
const PARTS: readonly DocumentPart[] = [
  "body",
  "header",
  "footer",
  "footnote",
  "comment",
];

const NODE_TYPES: readonly DocumentNodeType[] = [
  "heading",
  "paragraph",
  "list-item",
  "table",
  "footnote",
  "comment",
];

/**
 * Fragments a document sentence is assembled from. The hostile ones — a raw
 * newline, U+2028, a NUL, a combining sequence, an emoji, a quote and a
 * backslash — are what a line-oriented serializer and a parser disagree about,
 * so they belong in the corpus rather than in a hand-written corner case.
 */
const WORDS: readonly string[] = [
  "Исполнитель",
  "обязан",
  "не",
  "вправе",
  "оплатить",
  "штраф",
  "в",
  "течение",
  "10",
  "30",
  "рабочих",
  "календарных",
  "дней",
  "с",
  "момента",
  "подписания",
  "0.5",
  "1",
  "000",
  "₽",
  "%",
  "«не»",
  "—",
  "п.",
  "5.2",
  "true\\false",
  'a"b',
  "x\u0000y",
  "\u00A0nbsp",
  "soft\u00ADhyphen",
  "e\u0301",
  "ﬁle",
  "\u2028",
  "\u2029",
  "\uFEFF",
  "emoji \u{1F600}",
  "tab\there",
  "break\r\nhere",
  "",
];

const WARNING_CODES: readonly DocumentWarningCode[] = [
  "TRACK_CHANGES_PRESENT",
  "COMPARISON_QUALITY_REDUCED",
  "TABLE_EXTRACTION_DEGRADED",
  "OCR_USED",
];

const EXTRACTION_KINDS: readonly CanonicalExtractionKind[] = [
  "native-docx",
  "markdown",
  "plain-text",
  "pdf-text",
  "pdf-ocr",
];

export interface Random {
  /** Uniform float in `[0, 1)`. */
  readonly next: () => number;
  /** Uniform integer in `[0, limit)`. */
  readonly int: (limit: number) => number;
  readonly pick: <T>(items: readonly T[]) => T;
  readonly chance: (probability: number) => boolean;
}

/** mulberry32: 32 bits of state, no allocation, the same output on any host. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (limit) => Math.floor(next() * limit),
    pick: <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)] as T,
    chance: (probability) => next() < probability,
  };
}

/** Node text: from empty to a paragraph of hostile fragments. */
function randomText(random: Random): string {
  const shape = random.int(10);
  if (shape === 0) return "";
  if (shape === 1) return "   ";
  if (shape === 2) return random.pick(WORDS) as string;
  const taken: string[] = [];
  for (let index = 1 + random.int(8); index > 0; index -= 1) {
    taken.push(random.pick(WORDS) as string);
  }
  return taken.join(" ");
}

function randomHeadingPath(random: Random): string[] {
  const path: string[] = [];
  for (let index = random.int(3); index > 0; index -= 1) {
    path.push(`Раздел ${index}.${1 + random.int(9)}`);
  }
  return path;
}

function randomSource(random: Random, paragraph: number): NodeSource {
  return {
    ...(random.chance(0.7) ? { paragraph } : {}),
    ...(random.chance(0.3) ? { page: 1 + random.int(200) } : {}),
    ...(random.chance(0.2) ? { table: 1 + random.int(20) } : {}),
    ...(random.chance(0.4)
      ? {
          xmlPath: random.pick([
            "word/document2.xml",
            "word/header1.xml",
            "",
          ]) as string,
        }
      : {}),
  };
}

/** A location as the artifact writer sees it: every optional field in play. */
function randomLocation(random: Random): ChangeLocation {
  return {
    part: random.pick(PARTS) as DocumentPart,
    nodeIndex: random.int(1_000),
    headingPath: randomHeadingPath(random),
    ...(random.chance(0.6) ? { paragraph: random.int(500) } : {}),
    ...(random.chance(0.4) ? { page: random.int(200) } : {}),
    ...(random.chance(0.4) ? { table: random.int(20) } : {}),
    ...(random.chance(0.4) ? { row: random.int(40) } : {}),
    ...(random.chance(0.4) ? { column: random.int(8) } : {}),
    ...(random.chance(0.4)
      ? {
          xmlPath: random.pick([
            "word/footer1.xml",
            "docProps/core.xml",
          ]) as string,
        }
      : {}),
  };
}

function randomSpans(random: Random): DiffSpan[] {
  const spans: DiffSpan[] = [];
  for (let index = random.int(5); index > 0; index -= 1) {
    spans.push({
      kind: random.pick(["equal", "delete", "insert"] as const),
      text: randomText(random),
    });
  }
  return spans;
}

function randomSignals(random: Random): ChangeSignal[] {
  const picked = new Set<ChangeSignal>();
  for (let index = random.int(CHANGE_SIGNALS.length); index > 0; index -= 1) {
    picked.add(random.pick(CHANGE_SIGNALS) as ChangeSignal);
  }
  return [...picked];
}

/**
 * A change the writer could be asked to serialize. Fields stay correlated the
 * way the engine correlates them — a deletion carries no `after` — so the
 * corpus holds plausible shapes as well as exotic values.
 */
export function randomChange(random: Random): DocumentChange {
  const kind = random.pick(CHANGE_KINDS) as ChangeKind;
  const before = randomText(random);
  const after = randomText(random);
  return {
    id: `chg_${random.int(1_000_000_000).toString(16).padStart(12, "0")}`,
    kind,
    nodeType: random.pick(NODE_TYPES) as DocumentNodeType,
    ...(kind === "insert" ? {} : { left: randomLocation(random) }),
    ...(kind === "delete" ? {} : { right: randomLocation(random) }),
    ...(kind === "insert" ? {} : { before }),
    ...(kind === "delete" ? {} : { after }),
    ...(kind === "replace" && random.chance(0.8)
      ? { spans: randomSpans(random) }
      : {}),
    context: {
      headingPath: randomHeadingPath(random),
      ...(random.chance(0.5) ? { previous: randomText(random) } : {}),
      ...(random.chance(0.5) ? { next: randomText(random) } : {}),
    },
    signals: randomSignals(random),
    confidence: random.pick([0, 0.25, 0.5, 0.75, 0.999_999_999_999, 1]),
  };
}

function randomWarnings(random: Random): DocumentWarning[] {
  const taken: DocumentWarning[] = [];
  for (let index = random.int(3); index > 0; index -= 1) {
    taken.push({
      code: random.pick(WARNING_CODES) as DocumentWarningCode,
      message: `generated ${randomText(random)}`,
      ...(random.chance(0.5)
        ? { backend: random.pick(["native-docx", "pdf"]) as string }
        : {}),
      ...(random.chance(0.5)
        ? {
            details: {
              revisions: random.int(9),
              note: randomText(random),
            },
          }
        : {}),
    });
  }
  return taken;
}

interface DraftCell {
  readonly column: number;
  readonly rawText: string;
  readonly source: NodeSource;
}

/**
 * A node as an extractor would hand it to the collector — the same shape as
 * `NodeDraft`, with the fields a mutation has to move left writable.
 */
interface Draft {
  type: DocumentNodeType;
  part: DocumentPart;
  rawText: string;
  source: NodeSource;
  level?: number;
  revisions?: readonly NodeRevision[];
  formatting?: string;
  table?: {
    rows: readonly { row: number; cells: readonly DraftCell[] }[];
  };
}

/**
 * The node text an extractor gives a table: every row's cells joined by ` | `,
 * the rows joined by a newline. A generated table has to carry the text its
 * cells imply — otherwise the diff, which reads the cells, and the canonical
 * form, which reads the node, disagree about the same document.
 */
function tableText(
  rows: readonly { readonly cells: readonly { readonly rawText: string }[] }[],
): string {
  return rows
    .map((row) => row.cells.map((cell) => cell.rawText).join(" | "))
    .join("\n");
}

function randomTable(
  random: Random,
  paragraph: number,
): NonNullable<Draft["table"]> {
  const rows: { row: number; cells: DraftCell[] }[] = [];
  const rowCount = 1 + random.int(4);
  for (let row = 0; row < rowCount; row += 1) {
    const cells: DraftCell[] = [];
    const columnCount = 1 + random.int(4);
    for (let column = 0; column < columnCount; column += 1) {
      cells.push({
        column,
        rawText: randomText(random),
        source: {
          paragraph,
          table: 1 + random.int(20),
          row,
          column,
          ...(random.chance(0.3) ? { page: 1 + random.int(50) } : {}),
        },
      });
    }
    rows.push({ row, cells });
  }
  return { rows };
}

function randomDraft(random: Random, index: number): Draft {
  const type = random.pick(NODE_TYPES) as DocumentNodeType;
  const level = random.int(4) + 1;
  const table = type === "table" ? randomTable(random, index) : undefined;
  return {
    type,
    part: random.pick(PARTS) as DocumentPart,
    // An extractor never gives a table a text of its own.
    rawText: table === undefined ? randomText(random) : tableText(table.rows),
    source: randomSource(random, index),
    ...(type === "heading" ? { level } : {}),
    ...(table === undefined ? {} : { table }),
    ...(random.chance(0.2)
      ? {
          revisions: [
            {
              type: random.pick(["insert", "delete"] as const),
              ...(random.chance(0.7) ? { author: "Демо-лицо" } : {}),
              ...(random.chance(0.7) ? { date: "2026-09-25T00:00:00Z" } : {}),
              ...(random.chance(0.7) ? { text: randomText(random) } : {}),
            },
          ],
        }
      : {}),
    ...(random.chance(0.2)
      ? { formatting: random.pick(["b", "i", "b,i", ""]) as string }
      : {}),
  };
}

/**
 * Assemble drafts the way an extractor does, so ids, heading paths and
 * comparison keys are derived rather than invented — a hand-built node can be
 * shaped in a way no real document ever is.
 */
function documentFromDrafts(
  drafts: readonly Draft[],
  identity: {
    readonly kind: CanonicalExtractionKind;
    readonly extractor: string;
    readonly ocrUsed: boolean;
    readonly warnings: readonly DocumentWarning[];
  },
): CanonicalDocument {
  const collector = new CanonicalNodeCollector({ maxNodes: MAX_NODES });
  for (const draft of drafts) {
    collector.add(draft);
  }
  return collector.build(identity.kind, identity.extractor, {
    ocrUsed: identity.ocrUsed,
    warnings: identity.warnings,
  });
}

/** A document of random nodes, as the IR layer receives it. */
export function randomDocument(random: Random): CanonicalDocument {
  const drafts: Draft[] = [];
  for (let index = 0; index < 1 + random.int(9); index += 1) {
    drafts.push(randomDraft(random, index));
  }
  const kind = random.pick(EXTRACTION_KINDS) as CanonicalExtractionKind;
  return documentFromDrafts(drafts, {
    kind,
    extractor: `${kind}-backend`,
    ocrUsed: kind === "pdf-ocr",
    warnings: randomWarnings(random),
  });
}

/** A draft copy of a built document, ready to be edited and reassembled. */
function draftsOf(document: CanonicalDocument): Draft[] {
  return document.nodes.map((node) => ({
    type: node.type,
    part: node.part,
    rawText: node.rawText,
    source: node.source,
    ...(node.level === undefined ? {} : { level: node.level }),
    ...(node.revisions === undefined || node.revisions.length === 0
      ? {}
      : { revisions: node.revisions }),
    ...(node.formatting === undefined || node.formatting === ""
      ? {}
      : { formatting: node.formatting }),
    ...(node.table === undefined
      ? {}
      : {
          table: {
            rows: node.table.rows.map((row) => ({
              row: row.row,
              cells: row.cells.map((cell) => ({
                column: cell.column,
                rawText: cell.rawText,
                source: cell.source,
              })),
            })),
          },
        }),
  }));
}

/**
 * A second document derived from the first by one random edit. The edits land
 * on both sides of every decision the diff makes: an untouched copy, a
 * whitespace-only difference, a changed number, a moved node, a cell edit, a
 * formatting change, an added and a removed node.
 *
 * An edit that names table text targets a cell, because a table's node text is
 * derived from its cells; editing the joined text alone would build a node no
 * extractor could have produced, and the diff and the canonical form would
 * disagree about it for a reason that exists only in this file.
 */
const MOVES = [
  "none",
  "reword",
  "whitespace",
  "number",
  "insert",
  "delete",
  "swap",
  "tableCell",
  "formatting",
  "part",
] as const;

export function mutateDocument(
  random: Random,
  document: CanonicalDocument,
): CanonicalDocument {
  const drafts = draftsOf(document);
  const move = random.pick(MOVES) as (typeof MOVES)[number];
  const wantsTable = move === "tableCell";
  const wantsText =
    move === "reword" || move === "whitespace" || move === "number";
  const usable = drafts
    .map((draft, index) => ({ draft, index }))
    .filter(({ draft }) =>
      wantsTable
        ? draft.table !== undefined
        : wantsText
          ? draft.table === undefined
          : true,
    );
  const picked = usable.length === 0 ? undefined : random.pick(usable);
  const at = picked?.index ?? -1;
  const node = picked?.draft;
  if (node !== undefined && wantsText) {
    node.rawText =
      move === "reword"
        ? `${node.rawText} без согласования`
        : move === "number"
          ? `${node.rawText} 1 ${random.int(2) === 0 ? "10" : "30"}`
          : // Only whitespace: the comparison key must not move.
            node.rawText.replace(/\s/gu, "  ");
  }
  if (node !== undefined && move === "formatting") {
    node.formatting =
      node.formatting === undefined ? "b" : `${node.formatting},i`;
  }
  if (node !== undefined && move === "part") {
    node.part = node.part === "body" ? "footer" : "body";
  }
  if (node?.table !== undefined && move === "tableCell") {
    const rows = node.table.rows;
    const rowAt = random.int(rows.length);
    const cellAt = random.int(
      (rows[rowAt] as { cells: readonly unknown[] }).cells.length,
    );
    node.table = {
      rows: rows.map((row, rowIndex) =>
        rowIndex !== rowAt
          ? row
          : {
              ...row,
              cells: row.cells.map((cell, index) =>
                index !== cellAt
                  ? cell
                  : {
                      ...cell,
                      rawText: `${cell.rawText} (изм. ${random.int(100)})`,
                    },
              ),
            },
      ),
    };
    node.rawText = tableText(node.table.rows);
  }
  if (node !== undefined && move === "delete") {
    drafts.splice(at, 1);
  }
  if (move === "insert") {
    drafts.splice(at + 1, 0, randomDraft(random, drafts.length));
  }
  if (move === "swap" && drafts.length > 1 && node !== undefined) {
    const other = random.int(drafts.length);
    const held = drafts[at] as Draft;
    drafts[at] = drafts[other] as Draft;
    drafts[other] = held;
  }
  return documentFromDrafts(drafts, {
    kind: document.kind,
    extractor: document.extractor,
    ocrUsed: document.ocrUsed,
    warnings: document.warnings,
  });
}

/**
 * The canonical form of a document for comparison purposes: per part, the
 * strong key of every node, with a table expanded into its rows and cells.
 *
 * The table is expanded because the diff descends into it: two tables whose
 * joined text is unchanged but whose cells are not are a change, and the node
 * key alone would call the two documents identical.
 */
export function canonicalFormOf(
  document: CanonicalDocument,
): readonly (readonly string[])[] {
  return PARTS.map((part) => {
    const shape: string[] = [];
    for (const node of document.nodes.filter((entry) => entry.part === part)) {
      shape.push(strongKeyOf(node));
      for (const row of node.table?.rows ?? []) {
        shape.push(
          strongKeyOf({ type: "table-row", comparisonKey: row.comparisonKey }),
          ...row.cells.map((cell) =>
            strongKeyOf({
              type: "table-cell",
              comparisonKey: cell.comparisonKey,
            }),
          ),
        );
      }
    }
    return shape;
  });
}
