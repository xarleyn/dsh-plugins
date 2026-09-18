/**
 * Structural alignment of two node sequences (§13).
 *
 * Before anything can be called an edit, the two documents have to be put in
 * correspondence: which old paragraph is which new paragraph. Doing that by
 * position makes every insertion look like a rewrite of everything below it,
 * so alignment runs in two steps, in this order and for this reason:
 *
 * 1. **patience anchors** — nodes whose text is identical and *unique* on both
 *    sides are matched first, and the longest increasing run of those matches
 *    is taken as an anchor set. Text that appears once is the closest thing to
 *    a free lunch here: it cannot be mismatched, and it survives reordering.
 * 2. **similarity pairing inside the gaps** — what is left between two anchors
 *    is paired best-first by token overlap, and only above a threshold, so an
 *    unrelated replacement stays a delete plus an insert rather than becoming
 *    a fabricated "edit".
 *
 * The result is a set of pairs plus the leftovers, and it is deterministic:
 * every tie is broken by index, and no set iteration leaks into the output.
 */

import {
  MAX_PAIR_WORK,
  REPLACE_THRESHOLD,
  CROSS_TYPE_THRESHOLD,
  cachedTokens,
  characterSimilarity,
  diceFromTokens,
} from "./similarity.js";

/** What the aligner needs to know about one node. */
export interface Alignable {
  /** Node type; a heading never pairs with a paragraph at low similarity. */
  readonly type: string;
  /** Normalized text: the alignment key. */
  readonly comparisonKey: string;
}

export interface AlignmentPair {
  readonly left: number;
  readonly right: number;
  /** Token overlap of the pair, `1` for an exact anchor. */
  readonly similarity: number;
}

export interface SequenceAlignment {
  /** Matched node pairs, in left-document order. */
  readonly pairs: readonly AlignmentPair[];
  /** Left indices with no counterpart. */
  readonly leftOnly: readonly number[];
  /** Right indices with no counterpart. */
  readonly rightOnly: readonly number[];
}

export interface AlignOptions {
  readonly replaceThreshold?: number;
  readonly crossTypeThreshold?: number;
}

interface Range {
  readonly leftStart: number;
  readonly leftEnd: number;
  readonly rightStart: number;
  readonly rightEnd: number;
}

/** Types that may pair with each other when the text is nearly identical. */
const INTERCHANGEABLE = new Set(["paragraph", "list-item", "heading", "table"]);

export function alignSequences(
  left: readonly Alignable[],
  right: readonly Alignable[],
  options: AlignOptions = {},
): SequenceAlignment {
  const replaceThreshold = options.replaceThreshold ?? REPLACE_THRESHOLD;
  const crossTypeThreshold = options.crossTypeThreshold ?? CROSS_TYPE_THRESHOLD;
  const leftKeys = left.map(keyOf);
  const rightKeys = right.map(keyOf);
  const leftTokens = left.map((item) => cachedTokens(item.comparisonKey));
  const rightTokens = right.map((item) => cachedTokens(item.comparisonKey));

  const pairs: AlignmentPair[] = [];
  const gaps: Range[] = [];
  const work: Range[] = [
    {
      leftStart: 0,
      leftEnd: left.length,
      rightStart: 0,
      rightEnd: right.length,
    },
  ];
  while (work.length > 0) {
    const range = work.pop() as Range;
    if (
      range.leftStart >= range.leftEnd ||
      range.rightStart >= range.rightEnd
    ) {
      gaps.push(range);
      continue;
    }
    const anchors = patienceAnchors(leftKeys, rightKeys, range);
    if (anchors.length === 0) {
      gaps.push(range);
      continue;
    }
    let leftCursor = range.leftStart;
    let rightCursor = range.rightStart;
    for (const anchor of anchors) {
      work.push({
        leftStart: leftCursor,
        leftEnd: anchor.left,
        rightStart: rightCursor,
        rightEnd: anchor.right,
      });
      pairs.push({ left: anchor.left, right: anchor.right, similarity: 1 });
      leftCursor = anchor.left + 1;
      rightCursor = anchor.right + 1;
    }
    work.push({
      leftStart: leftCursor,
      leftEnd: range.leftEnd,
      rightStart: rightCursor,
      rightEnd: range.rightEnd,
    });
  }

  const leftOnly: number[] = [];
  const rightOnly: number[] = [];
  for (const gap of gaps) {
    if (gap.leftStart >= gap.leftEnd) {
      for (let index = gap.rightStart; index < gap.rightEnd; index += 1) {
        rightOnly.push(index);
      }
      continue;
    }
    if (gap.rightStart >= gap.rightEnd) {
      for (let index = gap.leftStart; index < gap.leftEnd; index += 1) {
        leftOnly.push(index);
      }
      continue;
    }
    const gapResult = pairGap(gap, {
      left,
      right,
      leftTokens,
      rightTokens,
      replaceThreshold,
      crossTypeThreshold,
    });
    pairs.push(...gapResult.pairs);
    leftOnly.push(...gapResult.leftOnly);
    rightOnly.push(...gapResult.rightOnly);
  }

  pairs.sort((first, second) => first.left - second.left);
  leftOnly.sort((first, second) => first - second);
  rightOnly.sort((first, second) => first - second);
  return { pairs, leftOnly, rightOnly };
}

function keyOf(item: Alignable): string {
  return `${item.type}\u0000${item.comparisonKey}`;
}

/**
 * Patience anchors: keys that occur exactly once on each side of the range,
 * reduced to their longest increasing run. The reduction is what makes the
 * anchors trustworthy — an unmatched key simply is not an anchor.
 */
function patienceAnchors(
  leftKeys: readonly string[],
  rightKeys: readonly string[],
  range: Range,
): { left: number; right: number }[] {
  const leftIndex = uniqueIndex(leftKeys, range.leftStart, range.leftEnd);
  const rightIndex = uniqueIndex(rightKeys, range.rightStart, range.rightEnd);
  const candidates: { left: number; right: number }[] = [];
  for (const [key, index] of leftIndex) {
    const match = rightIndex.get(key);
    if (match === undefined) continue;
    candidates.push({ left: index, right: match });
  }
  // Map iteration is insertion-ordered; sort so the anchor set never depends
  // on the order keys happened to be seen in.
  candidates.sort((first, second) => first.left - second.left);
  if (candidates.length === 0) return [];
  const run = longestIncreasingRun(candidates.map((entry) => entry.right));
  return run.map(
    (position) =>
      candidates[position] as {
        left: number;
        right: number;
      },
  );
}

function uniqueIndex(
  keys: readonly string[],
  start: number,
  end: number,
): Map<string, number> {
  const seen = new Map<string, number>();
  const duplicated = new Set<string>();
  for (let index = start; index < end; index += 1) {
    const key = keys[index] as string;
    if (seen.has(key)) {
      duplicated.add(key);
      continue;
    }
    seen.set(key, index);
  }
  for (const key of duplicated) seen.delete(key);
  return seen;
}

/** Positions of one longest strictly increasing subsequence. */
function longestIncreasingRun(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  const tails: number[] = [];
  const tailsPositions: number[] = [];
  const previous: number[] = new Array<number>(values.length).fill(-1);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((tails[middle] as number) < value) low = middle + 1;
      else high = middle;
    }
    tails[low] = value;
    tailsPositions[low] = index;
    previous[index] = low > 0 ? (tailsPositions[low - 1] as number) : -1;
  }
  const run: number[] = [];
  let cursor = tailsPositions[tails.length - 1] as number;
  while (cursor >= 0) {
    run.push(cursor);
    cursor = previous[cursor] as number;
  }
  return run.reverse();
}

interface GapContext {
  readonly left: readonly Alignable[];
  readonly right: readonly Alignable[];
  readonly leftTokens: readonly (readonly string[])[];
  readonly rightTokens: readonly (readonly string[])[];
  readonly replaceThreshold: number;
  readonly crossTypeThreshold: number;
}

/** Pair the unmatched nodes of one gap, best match first. */
function pairGap(
  gap: Range,
  context: GapContext,
): {
  pairs: AlignmentPair[];
  leftOnly: number[];
  rightOnly: number[];
} {
  const leftRange: number[] = [];
  for (let index = gap.leftStart; index < gap.leftEnd; index += 1) {
    leftRange.push(index);
  }
  const rightRange: number[] = [];
  for (let index = gap.rightStart; index < gap.rightEnd; index += 1) {
    rightRange.push(index);
  }
  const pairs: AlignmentPair[] = [];
  const leftUsed = new Set<number>();
  const rightUsed = new Set<number>();

  const positional = leftRange.length * rightRange.length > MAX_PAIR_WORK;
  if (!positional) {
    const candidates: {
      left: number;
      right: number;
      similarity: number;
    }[] = [];
    for (const leftIndex of leftRange) {
      for (const rightIndex of rightRange) {
        const similarity = score(leftIndex, rightIndex, context);
        if (similarity < context.replaceThreshold) continue;
        if (!compatible(leftIndex, rightIndex, similarity, context)) continue;
        candidates.push({ left: leftIndex, right: rightIndex, similarity });
      }
    }
    candidates.sort((first, second) => {
      if (second.similarity !== first.similarity) {
        return second.similarity - first.similarity;
      }
      if (first.left !== second.left) return first.left - second.left;
      return first.right - second.right;
    });
    for (const candidate of candidates) {
      if (leftUsed.has(candidate.left) || rightUsed.has(candidate.right)) {
        continue;
      }
      leftUsed.add(candidate.left);
      rightUsed.add(candidate.right);
      pairs.push(candidate);
    }
  } else {
    // A gap too large to score pairwise: pair by position, and let the caller
    // turn anything dissimilar enough into a delete plus an insert.
    const shared = Math.min(leftRange.length, rightRange.length);
    for (let offset = 0; offset < shared; offset += 1) {
      const leftIndex = leftRange[offset] as number;
      const rightIndex = rightRange[offset] as number;
      const similarity = score(leftIndex, rightIndex, context);
      if (
        similarity < context.replaceThreshold ||
        !compatible(leftIndex, rightIndex, similarity, context)
      ) {
        continue;
      }
      leftUsed.add(leftIndex);
      rightUsed.add(rightIndex);
      pairs.push({ left: leftIndex, right: rightIndex, similarity });
    }
  }

  return {
    pairs,
    leftOnly: leftRange.filter((index) => !leftUsed.has(index)),
    rightOnly: rightRange.filter((index) => !rightUsed.has(index)),
  };
}

function score(left: number, right: number, context: GapContext): number {
  const leftKey = (context.left[left] as Alignable).comparisonKey;
  const rightKey = (context.right[right] as Alignable).comparisonKey;
  if (leftKey === rightKey) return 1;
  return Math.max(
    diceFromTokens(
      context.leftTokens[left] as readonly string[],
      context.rightTokens[right] as readonly string[],
    ),
    characterSimilarity(leftKey, rightKey),
  );
}

/**
 * Whether two nodes of those types may be the same node. Same type always
 * may; the four text-bearing block types may swap among themselves when the
 * text is nearly identical (a paragraph promoted to a heading, a list
 * flattened into prose); tables pair only with tables or near-identical text.
 */
function compatible(
  left: number,
  right: number,
  similarity: number,
  context: GapContext,
): boolean {
  const leftType = (context.left[left] as Alignable).type;
  const rightType = (context.right[right] as Alignable).type;
  if (leftType === rightType) return true;
  if (!INTERCHANGEABLE.has(leftType) || !INTERCHANGEABLE.has(rightType)) {
    return false;
  }
  return similarity >= context.crossTypeThreshold;
}
