/**
 * Similarity between two pieces of text, for alignment only (§13).
 *
 * The aligner needs one number per candidate pair: "how likely is this the
 * same paragraph, edited?" Token multiset overlap (Sørensen–Dice) answers it
 * well for prose, is cheap, and — this is the part that matters for a contract
 * comparison — has no parameters that were fitted to English. A paragraph that
 * changed one word scores high; a paragraph replaced by an unrelated one
 * scores near zero.
 *
 * The number is used to *pair* nodes, never to report a change: nothing in the
 * change set depends on a similarity value beyond which side of a threshold it
 * fell on, and the thresholds are constants in this module.
 */

import { significantTokens } from "../canonical/tokenizer.js";

/** Above this, two nodes are treated as the same node edited hand-in-hand. */
export const REPLACE_THRESHOLD = 0.55;
/** Above this, nodes of different kinds may still be paired (a style change). */
export const CROSS_TYPE_THRESHOLD = 0.8;
/**
 * Token counts are trimmed to this before scoring. A paragraph is a few dozen
 * tokens; anything an order of magnitude larger is a wall of text whose middle
 * cannot change the answer, and trimming keeps the quadratic pairing bounded.
 */
export const SIMILARITY_TOKEN_CAP = 4_000;
/** Cell-by-cell pairing work cap; beyond it, pairing becomes positional. */
export const MAX_PAIR_WORK = 250_000;

const tokenCache = new Map<string, readonly string[]>();
const TOKEN_CACHE_LIMIT = 20_000;

/**
 * Significant tokens of a text, memoized by the text itself. Alignment asks
 * for the same node's tokens once per candidate pair, and re-tokenizing a
 * paragraph hundreds of times is the difference between instant and sluggish.
 */
export function cachedTokens(text: string): readonly string[] {
  const cached = tokenCache.get(text);
  if (cached !== undefined) return cached;
  const tokens = significantTokens(text).slice(0, SIMILARITY_TOKEN_CAP);
  if (tokenCache.size >= TOKEN_CACHE_LIMIT) tokenCache.clear();
  tokenCache.set(text, tokens);
  return tokens;
}

/** Drop memoized tokenizations; called when a comparison finishes. */
export function releaseTokenCache(): void {
  tokenCache.clear();
}

/**
 * Character-level similarity, for the texts token overlap cannot judge: a
 * two-word paragraph with one punctuation mark changed shares half its tokens,
 * which reads as "different" to Dice and as "obviously the same sentence" to a
 * person. Normalized edit distance answers the second question.
 *
 * Bounded: beyond `CHAR_LIMIT` characters the distance is skipped and the
 * token score stands alone, because the cost is quadratic in the text length.
 */
const CHAR_LIMIT = 512;

export function characterSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length > CHAR_LIMIT || right.length > CHAR_LIMIT) return 0;
  const distance = editDistance(left, right);
  const longest = Math.max(left.length, right.length);
  return longest === 0 ? 1 : 1 - distance / longest;
}

function editDistance(left: string, right: string): number {
  const previous = new Uint32Array(right.length + 1);
  const current = new Uint32Array(right.length + 1);
  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitution =
        (previous[column - 1] as number) +
        (left[row - 1] === right[column - 1] ? 0 : 1);
      current[column] = Math.min(
        (previous[column] as number) + 1,
        (current[column - 1] as number) + 1,
        substitution,
      );
    }
    previous.set(current);
  }
  return previous[right.length] as number;
}

/** Sørensen–Dice overlap of two token multisets, in `[0, 1]`. */
export function diceFromTokens(
  left: readonly string[],
  right: readonly string[],
): number {
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of left) counts.set(token, (counts.get(token) ?? 0) + 1);
  let shared = 0;
  for (const token of right) {
    const remaining = counts.get(token);
    if (remaining === undefined || remaining === 0) continue;
    counts.set(token, remaining - 1);
    shared += 1;
  }
  return (2 * shared) / (left.length + right.length);
}

/**
 * How likely two nodes are the same node, edited. The larger of the token
 * overlap and the character similarity: long prose is judged by its words, and
 * a short paragraph by how close the two strings actually are.
 */
export function similarityOf(left: string, right: string): number {
  if (left === right) return 1;
  return Math.max(
    diceFromTokens(cachedTokens(left), cachedTokens(right)),
    characterSimilarity(left, right),
  );
}
