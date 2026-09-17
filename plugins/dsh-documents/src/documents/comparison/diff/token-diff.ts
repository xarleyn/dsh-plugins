/**
 * Deterministic token diff (§14).
 *
 * Once two nodes are known to be the same node, this is what turns "the
 * paragraph changed" into "`10 рабочих` became `30 календарных`". It is a
 * longest-common-subsequence walk over tokens — the textbook algorithm, chosen
 * because its result is a pure function of its input: same two texts, same
 * spans, same order, on any host, in any version.
 *
 * Two guards keep it honest on hostile input rather than merely slow:
 *
 * - common prefix and suffix are trimmed first, which is most of the win on
 *   real edits (a sentence with one word changed) and costs nothing;
 * - the table is capped. A pair of texts whose product exceeds the cap is
 *   reported as one whole replacement instead of a span-by-span edit: the
 *   change is still exact, it is just not decomposed further.
 */

import type { DiffSpan } from "../types.js";

export interface TokenDiffOp {
  readonly kind: "equal" | "delete" | "insert";
  readonly start: number;
  readonly end: number;
}

/** Cells (`tokens × tokens`) the dynamic-programming table may hold. */
export const MAX_DIFF_CELLS = 4_000_000;

export function diffTokens(
  left: readonly string[],
  right: readonly string[],
): TokenDiffOp[] {
  const prefix = commonPrefixLength(left, right);
  const suffix = commonSuffixLength(left, right, prefix);
  const leftMid = left.slice(prefix, left.length - suffix);
  const rightMid = right.slice(prefix, right.length - suffix);
  const ops: TokenDiffOp[] = [];
  if (prefix > 0) ops.push({ kind: "equal", start: 0, end: prefix });
  if (leftMid.length > 0 && rightMid.length > 0) {
    if (leftMid.length * rightMid.length <= MAX_DIFF_CELLS) {
      for (const op of walkLcs(leftMid, rightMid)) {
        ops.push({
          kind: op.kind,
          start: op.start + prefix,
          end: op.end + prefix,
        });
      }
    } else {
      ops.push({ kind: "delete", start: prefix, end: prefix + leftMid.length });
      ops.push({
        kind: "insert",
        start: prefix,
        end: prefix + rightMid.length,
      });
    }
  } else if (leftMid.length > 0) {
    ops.push({ kind: "delete", start: prefix, end: prefix + leftMid.length });
  } else if (rightMid.length > 0) {
    ops.push({ kind: "insert", start: prefix, end: prefix + rightMid.length });
  }
  if (suffix > 0) {
    ops.push({
      kind: "equal",
      start: left.length - suffix,
      end: left.length,
    });
  }
  return ops;
}

/**
 * Render the ops as spans of text. Equal spans are read from the left side
 * (they are equal by definition); each span's text is the concatenation of the
 * tokens it covers, so the spans of one side reassemble that side exactly.
 */
export function spansFromOps(
  ops: readonly TokenDiffOp[],
  left: readonly string[],
  right: readonly string[],
): DiffSpan[] {
  return ops.map((op) => ({
    kind: op.kind,
    text:
      op.kind === "insert"
        ? right.slice(op.start, op.end).join("")
        : left.slice(op.start, op.end).join(""),
  }));
}

/** Token-level diff of two tokenized texts, as spans ready for a change. */
export function diffText(
  leftTokens: readonly { readonly text: string }[],
  rightTokens: readonly { readonly text: string }[],
): DiffSpan[] {
  const left = leftTokens.map((token) => token.text);
  const right = rightTokens.map((token) => token.text);
  return spansFromOps(diffTokens(left, right), left, right);
}

function commonPrefixLength(
  left: readonly string[],
  right: readonly string[],
): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(
  left: readonly string[],
  right: readonly string[],
  prefix: number,
): number {
  const limit = Math.min(left.length, right.length) - prefix;
  let count = 0;
  while (
    count < limit &&
    left[left.length - 1 - count] === right[right.length - 1 - count]
  ) {
    count += 1;
  }
  return count;
}

/**
 * LCS walk over the trimmed middles. Ties are broken towards deletion, which
 * only decides how an ambiguous edit is annotated — the pair of texts always
 * reproduces exactly, whatever the tie-break.
 */
function walkLcs(
  left: readonly string[],
  right: readonly string[],
): TokenDiffOp[] {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const table = new Int32Array(rows * columns);
  for (let row = left.length - 1; row >= 0; row -= 1) {
    const rowBase = row * columns;
    const nextBase = rowBase + columns;
    for (let column = right.length - 1; column >= 0; column -= 1) {
      table[rowBase + column] =
        left[row] === right[column]
          ? (table[nextBase + column + 1] as number) + 1
          : Math.max(
              table[nextBase + column] as number,
              table[rowBase + column + 1] as number,
            );
    }
  }
  const ops: TokenDiffOp[] = [];
  const push = (kind: TokenDiffOp["kind"], index: number): void => {
    const last = ops[ops.length - 1];
    if (last !== undefined && last.kind === kind && last.end === index) {
      ops[ops.length - 1] = { kind, start: last.start, end: index + 1 };
      return;
    }
    ops.push({ kind, start: index, end: index + 1 });
  };
  let row = 0;
  let column = 0;
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      push("equal", row);
      row += 1;
      column += 1;
      continue;
    }
    const down = table[(row + 1) * columns + column] as number;
    const across = table[row * columns + column + 1] as number;
    if (down >= across) {
      push("delete", row);
      row += 1;
    } else {
      push("insert", row);
      column += 1;
    }
  }
  while (row < left.length) {
    push("delete", row);
    row += 1;
  }
  while (column < right.length) {
    push("insert", left.length);
    column += 1;
  }
  // Deletions and insertions are indexed against different sides; rebuild the
  // right-hand offsets by walking the ops in order of the left side.
  return normalizeInsertOffsets(ops);
}

/**
 * `walkLcs` builds ops against two cursors at once, so insert runs carry the
 * left cursor as their start. Re-index each side on its own so both are true
 * offsets into their own token array.
 */
function normalizeInsertOffsets(ops: readonly TokenDiffOp[]): TokenDiffOp[] {
  let leftCursor = 0;
  let rightCursor = 0;
  const output: TokenDiffOp[] = [];
  for (const op of ops) {
    const length = op.end - op.start;
    if (op.kind === "equal") {
      output.push({
        kind: "equal",
        start: leftCursor,
        end: leftCursor + length,
      });
      leftCursor += length;
      rightCursor += length;
      continue;
    }
    if (op.kind === "delete") {
      output.push({
        kind: "delete",
        start: leftCursor,
        end: leftCursor + length,
      });
      leftCursor += length;
      continue;
    }
    output.push({
      kind: "insert",
      start: rightCursor,
      end: rightCursor + length,
    });
    rightCursor += length;
  }
  return output;
}
