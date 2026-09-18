/**
 * The change generator (§14, §15, §17, §27).
 *
 * This is where the deterministic layer stops being plumbing and starts making
 * claims: which nodes are the same node, what changed inside them, what kind of
 * change it is, and how much the layer trusts each one. Everything the model
 * later reasons about comes from here, and nothing here asks a model anything.
 *
 * The set is built one document part at a time (body, then headers, footers,
 * footnotes, comments) and ordered the way a reader walks a document, with each
 * deletion attached to the position where it disappeared. That order is part of
 * the contract: line *n* of `changes.jsonl` is the same line on every run over
 * the same inputs.
 */

import type {
  CanonicalDocument,
  CanonicalNode,
  CanonicalTableCell,
  CanonicalTableRow,
  DocumentNodeType,
  DocumentPart,
  NodeSource,
} from "../canonical/document-ir.js";
import { DOCUMENT_PART_ORDER, nodesOfPart } from "../canonical/document-ir.js";
import { tokenize } from "../canonical/tokenizer.js";
import { alignSequences, type Alignable } from "../alignment/block-align.js";
import {
  releaseTokenCache,
  REPLACE_THRESHOLD,
} from "../alignment/similarity.js";
import { createChangeId } from "./change-id.js";
import { detectMoves, moveHash } from "./move-detection.js";
import { diffText } from "./token-diff.js";
import { detectSignals } from "../signals/index.js";
import type {
  ChangeKind,
  ChangeLocation,
  ChangeSignal,
  DiffSpan,
  DocumentChange,
} from "../types.js";

export interface DiffContext {
  readonly leftSha: string;
  readonly rightSha: string;
  readonly detectMoves: boolean;
  readonly ignoreWhitespace: boolean;
  readonly ignoreFormatting: boolean;
  /** Confidence ceiling for this pair, from the extraction quality (§25). */
  readonly confidence: number;
  /** Called between stages; throws when the comparison ran out of time. */
  readonly checkBudget: () => void;
}

interface Draft {
  readonly kind: ChangeKind;
  readonly nodeType: DocumentNodeType;
  readonly part: DocumentPart;
  /** Ordering position inside the part: the right-side node index. */
  readonly position: number;
  /** Tie-break at one position: deletions first, then the node itself. */
  readonly order: number;
  readonly left?: { readonly index: number; readonly location: ChangeLocation };
  readonly right?: {
    readonly index: number;
    readonly location: ChangeLocation;
  };
  readonly before?: string;
  readonly after?: string;
  readonly spans?: readonly DiffSpan[];
  readonly signals: readonly ChangeSignal[];
  readonly confidence: number;
}

/** One step of the merged walk over the two aligned node sequences. */
type Step =
  | {
      readonly kind: "pair";
      readonly left: number;
      readonly right: number;
      readonly similarity: number;
    }
  | {
      readonly kind: "delete";
      readonly left: number;
      /** Position in the revised document where the node disappeared. */
      readonly position: number;
    }
  | { readonly kind: "insert"; readonly right: number };

export function diffDocuments(
  left: CanonicalDocument,
  right: CanonicalDocument,
  context: DiffContext,
): DocumentChange[] {
  const drafts: Draft[] = [];
  try {
    for (const part of DOCUMENT_PART_ORDER) {
      context.checkBudget();
      const leftNodes = nodesOfPart(left, part);
      const rightNodes = nodesOfPart(right, part);
      if (leftNodes.length === 0 && rightNodes.length === 0) continue;
      drafts.push(...diffPart(part, leftNodes, rightNodes, context));
    }
  } finally {
    releaseTokenCache();
  }
  return drafts.map((draft) => finalize(draft, context));
}

function diffPart(
  part: DocumentPart,
  leftNodes: readonly CanonicalNode[],
  rightNodes: readonly CanonicalNode[],
  context: DiffContext,
): Draft[] {
  const alignment = alignSequences(
    leftNodes.map(alignableOf),
    rightNodes.map(alignableOf),
  );

  // Interleave the aligner's three outputs into one walk, so every step knows
  // where it sits in the revised document.
  const steps: Step[] = [];
  const rightOnly = [...alignment.rightOnly];
  let rightCursor = 0;
  let leftCursor = 0;
  const flushInserts = (limit: number): void => {
    while (
      rightCursor < rightOnly.length &&
      (rightOnly[rightCursor] as number) < limit
    ) {
      steps.push({ kind: "insert", right: rightOnly[rightCursor] as number });
      rightCursor += 1;
    }
  };
  const flushDeletes = (limit: number): void => {
    while (
      leftCursor < alignment.leftOnly.length &&
      (alignment.leftOnly[leftCursor] as number) < limit
    ) {
      steps.push({
        kind: "delete",
        left: alignment.leftOnly[leftCursor] as number,
        position: UNSET_POSITION,
      });
      leftCursor += 1;
    }
  };
  for (const pair of alignment.pairs) {
    flushInserts(pair.right);
    flushDeletes(pair.left);
    // A deletion is reported where it disappeared: just before the node that
    // took its place, or at the end when nothing did.
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      const step = steps[index] as Step;
      if (step.kind !== "delete" || step.position !== UNSET_POSITION) break;
      steps[index] = { kind: "delete", left: step.left, position: pair.right };
    }
    steps.push({
      kind: "pair",
      left: pair.left,
      right: pair.right,
      similarity: pair.similarity,
    });
  }
  flushInserts(rightNodes.length);
  flushDeletes(leftNodes.length);
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] as Step;
    if (step.kind === "delete" && step.position === UNSET_POSITION) {
      steps[index] = {
        kind: "delete",
        left: step.left,
        position: rightNodes.length,
      };
    }
  }

  const deletes = steps.filter(
    (step): step is Extract<Step, { kind: "delete" }> => step.kind === "delete",
  );
  const inserts = steps.filter(
    (step): step is Extract<Step, { kind: "insert" }> => step.kind === "insert",
  );
  const moves = context.detectMoves
    ? detectMoves(
        deletes.map((step) =>
          moveHash(
            part,
            (leftNodes[step.left] as CanonicalNode).type,
            (leftNodes[step.left] as CanonicalNode).rawText,
          ),
        ),
        inserts.map((step) =>
          moveHash(
            part,
            (rightNodes[step.right] as CanonicalNode).type,
            (rightNodes[step.right] as CanonicalNode).rawText,
          ),
        ),
      )
    : {
        moves: [] as const,
        deleted: deletes.map((_step, index) => index),
        inserted: inserts.map((_step, index) => index),
      };
  const movedDeletes = new Map(
    moves.moves.map((move) => [move.deleteIndex, move.insertIndex] as const),
  );
  const movedInserts = new Set(moves.moves.map((move) => move.insertIndex));
  const survivingDeletes = new Set(moves.deleted);
  const survivingInserts = new Set(moves.inserted);

  const drafts: Draft[] = [];
  let deleteOrder = 0;
  let insertOrder = 0;
  for (const step of steps) {
    if (step.kind === "delete") {
      const deleteIndex = deleteOrder;
      deleteOrder += 1;
      const moveTarget = movedDeletes.get(deleteIndex);
      if (moveTarget !== undefined) {
        const from = leftNodes[step.left] as CanonicalNode;
        const rightIndex = (inserts[moveTarget] as { right: number }).right;
        const to = rightNodes[rightIndex] as CanonicalNode;
        drafts.push({
          kind: "move",
          nodeType: to.type,
          part,
          position: rightIndex,
          order: 0,
          left: { index: step.left, location: locationOf(from, step.left) },
          right: { index: rightIndex, location: locationOf(to, rightIndex) },
          before: from.rawText,
          after: to.rawText,
          signals: [],
          confidence: context.confidence,
        });
        continue;
      }
      if (!survivingDeletes.has(deleteIndex)) continue;
      const node = leftNodes[step.left] as CanonicalNode;
      drafts.push({
        kind: "delete",
        nodeType: node.type,
        part,
        position: step.position,
        order: -1,
        left: { index: step.left, location: locationOf(node, step.left) },
        before: node.rawText,
        signals: detectSignals({ before: node.rawText }),
        confidence: context.confidence,
      });
      continue;
    }
    if (step.kind === "insert") {
      const insertIndex = insertOrder;
      insertOrder += 1;
      if (movedInserts.has(insertIndex) || !survivingInserts.has(insertIndex)) {
        continue;
      }
      const node = rightNodes[step.right] as CanonicalNode;
      drafts.push({
        kind: "insert",
        nodeType: node.type,
        part,
        position: step.right,
        order: 0,
        right: { index: step.right, location: locationOf(node, step.right) },
        after: node.rawText,
        signals: detectSignals({ after: node.rawText }),
        confidence: context.confidence,
      });
      continue;
    }
    const leftNode = leftNodes[step.left] as CanonicalNode;
    const rightNode = rightNodes[step.right] as CanonicalNode;
    drafts.push(
      ...diffPair(
        part,
        leftNode,
        step.left,
        rightNode,
        step.right,
        step.similarity,
        context,
      ),
    );
  }

  return drafts.sort((first, second) => {
    if (first.position !== second.position) {
      return first.position - second.position;
    }
    return first.order - second.order;
  });
}

/* ------------------------------------------------------------------ pairs */

function diffPair(
  part: DocumentPart,
  leftNode: CanonicalNode,
  leftIndex: number,
  rightNode: CanonicalNode,
  rightIndex: number,
  similarity: number,
  context: DiffContext,
): Draft[] {
  const confidence = scaled(context.confidence, similarity);
  const left = { index: leftIndex, location: locationOf(leftNode, leftIndex) };
  const right = {
    index: rightIndex,
    location: locationOf(rightNode, rightIndex),
  };

  if (leftNode.type === "table" && rightNode.type === "table") {
    return diffTables(
      part,
      leftNode,
      leftIndex,
      rightNode,
      rightIndex,
      context,
    );
  }

  if (leftNode.comparisonKey === rightNode.comparisonKey) {
    if (leftNode.rawText !== rightNode.rawText && !context.ignoreWhitespace) {
      return [
        replaceDraft(
          part,
          leftNode.rawText,
          rightNode.rawText,
          left,
          right,
          rightNode.type,
          similarity,
          context,
        ),
      ];
    }
    if (
      !context.ignoreFormatting &&
      leftNode.formatting !== undefined &&
      rightNode.formatting !== undefined &&
      leftNode.formatting !== rightNode.formatting
    ) {
      return [
        {
          kind: "replace",
          nodeType: rightNode.type,
          part,
          position: rightIndex,
          order: 0,
          left,
          right,
          before: leftNode.rawText,
          after: rightNode.rawText,
          spans: [],
          signals: ["FORMATTING_CHANGED"],
          confidence,
        },
      ];
    }
    return [];
  }

  return [
    replaceDraft(
      part,
      leftNode.rawText,
      rightNode.rawText,
      left,
      right,
      rightNode.type,
      similarity,
      context,
    ),
  ];
}

function replaceDraft(
  part: DocumentPart,
  before: string,
  after: string,
  left: Draft["left"],
  right: Draft["right"],
  nodeType: DocumentNodeType,
  similarity: number,
  context: DiffContext,
): Draft {
  const spans = diffText(tokenize(before), tokenize(after));
  return {
    kind: "replace",
    nodeType,
    part,
    position: right?.index ?? 0,
    order: 0,
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right }),
    before,
    after,
    spans,
    signals: detectSignals({ before, after }),
    confidence: scaled(context.confidence, similarity),
  };
}

/** Above this similarity a pairing is not in doubt, whatever it is. */
const SURE_PAIRING = 0.85;
/** A pairing that barely cleared the threshold keeps three quarters of it. */
const MIN_PAIRING_FACTOR = 0.75;

/**
 * Confidence of a change, given the quality of the extraction and the
 * similarity the aligner scored for the pair. Similarity does not make a change
 * more true — the texts are what they are — it says how much the layer trusts
 * that these two nodes are the same node, which is exactly the doubt worth
 * expressing.
 */
function scaled(confidence: number, similarity: number): number {
  const factor =
    similarity >= SURE_PAIRING
      ? 1
      : MIN_PAIRING_FACTOR +
        (1 - MIN_PAIRING_FACTOR) *
          (Math.max(0, similarity - REPLACE_THRESHOLD) /
            (SURE_PAIRING - REPLACE_THRESHOLD));
  return Math.round((confidence * factor + Number.EPSILON) * 100) / 100;
}

/* ----------------------------------------------------------------- tables */

function diffTables(
  part: DocumentPart,
  leftTable: CanonicalNode,
  leftTableIndex: number,
  rightTable: CanonicalNode,
  rightTableIndex: number,
  context: DiffContext,
): Draft[] {
  const leftRows = leftTable.table?.rows ?? [];
  const rightRows = rightTable.table?.rows ?? [];
  const alignment = alignSequences(
    leftRows.map(rowAlignable),
    rightRows.map(rowAlignable),
  );
  const rightOnly = [...alignment.rightOnly];
  const drafts: Draft[] = [];
  let rightCursor = 0;
  let leftCursor = 0;
  let order = 0;
  const flushInserts = (limit: number): void => {
    while (
      rightCursor < rightOnly.length &&
      (rightOnly[rightCursor] as number) < limit
    ) {
      const index = rightOnly[rightCursor] as number;
      rightCursor += 1;
      const row = rightRows[index] as CanonicalTableRow;
      order += 1;
      drafts.push({
        kind: "insert",
        nodeType: "table-row",
        part,
        position: rightTableIndex,
        order,
        right: {
          index: rightTableIndex,
          location: cellLocation(
            rightTable,
            rightTableIndex,
            rowSource(rightTable, row),
          ),
        },
        after: row.rawText,
        signals: detectSignals({ after: row.rawText }),
        confidence: context.confidence,
      });
    }
  };
  for (const pair of alignment.pairs) {
    flushInserts(pair.right);
    while (
      leftCursor < alignment.leftOnly.length &&
      (alignment.leftOnly[leftCursor] as number) < pair.left
    ) {
      const index = alignment.leftOnly[leftCursor] as number;
      leftCursor += 1;
      const row = leftRows[index] as CanonicalTableRow;
      order += 1;
      drafts.push({
        kind: "delete",
        nodeType: "table-row",
        part,
        position: rightTableIndex,
        order,
        left: {
          index: leftTableIndex,
          location: cellLocation(
            leftTable,
            leftTableIndex,
            rowSource(leftTable, row),
          ),
        },
        before: row.rawText,
        signals: detectSignals({ before: row.rawText }),
        confidence: context.confidence,
      });
    }
    const leftRow = leftRows[pair.left] as CanonicalTableRow;
    const rightRow = rightRows[pair.right] as CanonicalTableRow;
    order += 1;
    drafts.push(
      ...diffRowCells(
        part,
        leftTable,
        leftTableIndex,
        rightTable,
        rightTableIndex,
        leftRow,
        rightRow,
        order,
        context,
      ),
    );
  }
  flushInserts(rightRows.length);
  while (leftCursor < alignment.leftOnly.length) {
    const index = alignment.leftOnly[leftCursor] as number;
    leftCursor += 1;
    const row = leftRows[index] as CanonicalTableRow;
    order += 1;
    drafts.push({
      kind: "delete",
      nodeType: "table-row",
      part,
      position: rightTableIndex,
      order,
      left: {
        index: leftTableIndex,
        location: cellLocation(
          leftTable,
          leftTableIndex,
          rowSource(leftTable, row),
        ),
      },
      before: row.rawText,
      signals: detectSignals({ before: row.rawText }),
      confidence: context.confidence,
    });
  }
  return drafts;
}

function diffRowCells(
  part: DocumentPart,
  leftTable: CanonicalNode,
  leftTableIndex: number,
  rightTable: CanonicalNode,
  rightTableIndex: number,
  leftRow: CanonicalTableRow,
  rightRow: CanonicalTableRow,
  order: number,
  context: DiffContext,
): Draft[] {
  const alignment = alignSequences(
    leftRow.cells.map(cellAlignable),
    rightRow.cells.map(cellAlignable),
  );
  const drafts: Draft[] = [];
  const rightOnly = [...alignment.rightOnly];
  let rightCursor = 0;
  let leftCursor = 0;
  let innerOrder = order;
  const flushInserts = (limit: number): void => {
    while (
      rightCursor < rightOnly.length &&
      (rightOnly[rightCursor] as number) < limit
    ) {
      const index = rightOnly[rightCursor] as number;
      rightCursor += 1;
      const cell = rightRow.cells[index] as CanonicalTableCell;
      innerOrder += 1;
      drafts.push({
        kind: "insert",
        nodeType: "table-cell",
        part,
        position: rightTableIndex,
        order: innerOrder,
        right: {
          index: rightTableIndex,
          location: cellLocation(rightTable, rightTableIndex, cell.source),
        },
        after: cell.rawText,
        signals: detectSignals({ after: cell.rawText }),
        confidence: context.confidence,
      });
    }
  };
  for (const pair of alignment.pairs) {
    flushInserts(pair.right);
    while (
      leftCursor < alignment.leftOnly.length &&
      (alignment.leftOnly[leftCursor] as number) < pair.left
    ) {
      const index = alignment.leftOnly[leftCursor] as number;
      leftCursor += 1;
      const cell = leftRow.cells[index] as CanonicalTableCell;
      innerOrder += 1;
      drafts.push({
        kind: "delete",
        nodeType: "table-cell",
        part,
        position: rightTableIndex,
        order: innerOrder,
        left: {
          index: leftTableIndex,
          location: cellLocation(leftTable, leftTableIndex, cell.source),
        },
        before: cell.rawText,
        signals: detectSignals({ before: cell.rawText }),
        confidence: context.confidence,
      });
    }
    const leftCell = leftRow.cells[pair.left] as CanonicalTableCell;
    const rightCell = rightRow.cells[pair.right] as CanonicalTableCell;
    const whitespaceOnly =
      leftCell.comparisonKey === rightCell.comparisonKey &&
      (context.ignoreWhitespace || leftCell.rawText === rightCell.rawText);
    if (whitespaceOnly) continue;
    innerOrder += 1;
    drafts.push({
      ...replaceDraft(
        part,
        leftCell.rawText,
        rightCell.rawText,
        {
          index: leftTableIndex,
          location: cellLocation(leftTable, leftTableIndex, leftCell.source),
        },
        {
          index: rightTableIndex,
          location: cellLocation(rightTable, rightTableIndex, rightCell.source),
        },
        "table-cell",
        pair.similarity,
        context,
      ),
      position: rightTableIndex,
      order: innerOrder,
    });
  }
  flushInserts(rightRow.cells.length);
  while (leftCursor < alignment.leftOnly.length) {
    const index = alignment.leftOnly[leftCursor] as number;
    leftCursor += 1;
    const cell = leftRow.cells[index] as CanonicalTableCell;
    innerOrder += 1;
    drafts.push({
      kind: "delete",
      nodeType: "table-cell",
      part,
      position: rightTableIndex,
      order: innerOrder,
      left: {
        index: leftTableIndex,
        location: cellLocation(leftTable, leftTableIndex, cell.source),
      },
      before: cell.rawText,
      signals: detectSignals({ before: cell.rawText }),
      confidence: context.confidence,
    });
  }
  return drafts;
}

/* -------------------------------------------------------------- locations */

function locationOf(node: CanonicalNode, partIndex: number): ChangeLocation {
  return {
    part: node.part,
    nodeIndex: partIndex,
    headingPath: node.path,
    ...sourceFields(node.source),
  };
}

/** A row or a cell: the table's place in the document, the grid's coordinates. */
function cellLocation(
  table: CanonicalNode,
  tableIndex: number,
  source: NodeSource,
): ChangeLocation {
  return {
    part: table.part,
    nodeIndex: tableIndex,
    headingPath: table.path,
    ...sourceFields(source),
  };
}

function sourceFields(source: NodeSource): {
  readonly paragraph?: number;
  readonly page?: number;
  readonly table?: number;
  readonly row?: number;
  readonly column?: number;
  readonly xmlPath?: string;
} {
  return {
    ...(source.paragraph === undefined ? {} : { paragraph: source.paragraph }),
    ...(source.page === undefined ? {} : { page: source.page }),
    ...(source.table === undefined ? {} : { table: source.table }),
    ...(source.row === undefined ? {} : { row: source.row }),
    ...(source.column === undefined ? {} : { column: source.column }),
    ...(source.xmlPath === undefined ? {} : { xmlPath: source.xmlPath }),
  };
}

function finalize(draft: Draft, context: DiffContext): DocumentChange {
  const id = createChangeId({
    leftSha: context.leftSha,
    rightSha: context.rightSha,
    part: draft.part,
    kind: draft.kind,
    ...(draft.before === undefined ? {} : { before: draft.before }),
    ...(draft.after === undefined ? {} : { after: draft.after }),
    ...(draft.left === undefined ? {} : { leftIndex: draft.left.index }),
    ...(draft.right === undefined ? {} : { rightIndex: draft.right.index }),
    ...(draft.right?.location.table === undefined ||
    draft.right.location.row === undefined ||
    draft.right.location.column === undefined
      ? {}
      : {
          cell: {
            table: draft.right.location.table,
            row: draft.right.location.row,
            column: draft.right.location.column,
          },
        }),
  });
  const headingPath =
    draft.right?.location.headingPath ?? draft.left?.location.headingPath ?? [];
  return {
    id,
    kind: draft.kind,
    nodeType: draft.nodeType,
    ...(draft.left === undefined ? {} : { left: draft.left.location }),
    ...(draft.right === undefined ? {} : { right: draft.right.location }),
    ...(draft.before === undefined ? {} : { before: draft.before }),
    ...(draft.after === undefined ? {} : { after: draft.after }),
    ...(draft.spans === undefined ? {} : { spans: draft.spans }),
    context: { headingPath },
    signals: draft.signals,
    confidence: draft.confidence,
  };
}

/**
 * Position sentinel for a deletion whose place in the revised document is not
 * known yet; filled in once the walk reaches the node that follows it.
 */
const UNSET_POSITION = -1;

/** A row has no source of its own; the table's grid gives it coordinates. */
function rowSource(table: CanonicalNode, row: CanonicalTableRow): NodeSource {
  return {
    ...(table.source.paragraph === undefined
      ? {}
      : { paragraph: table.source.paragraph }),
    ...(table.source.table === undefined ? {} : { table: table.source.table }),
    row: row.row,
    ...(table.source.xmlPath === undefined
      ? {}
      : { xmlPath: table.source.xmlPath }),
  };
}

function alignableOf(node: CanonicalNode): Alignable {
  return { type: node.type, comparisonKey: node.comparisonKey };
}

function rowAlignable(row: CanonicalTableRow): Alignable {
  return { type: "table-row", comparisonKey: row.comparisonKey };
}

function cellAlignable(cell: CanonicalTableCell): Alignable {
  return { type: "table-cell", comparisonKey: cell.comparisonKey };
}
