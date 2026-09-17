/**
 * Move detection (§16).
 *
 * A clause that is renumbered from 4.3 to 7.2 is not a deletion plus an
 * insertion, and reporting it as one buries the actual edits under noise: the
 * reader has to remember a paragraph they already read to notice that the next
 * one is new. When a deleted node and an inserted node carry the same text —
 * byte for byte, after normalization — the pair is reported as one `move`.
 *
 * Only exact matches are moves. A paragraph that was *edited* while being moved
 * is genuinely two facts (something went away, something appeared), and calling
 * it a move would hide the edit; the spec leaves that refinement to a later
 * pass.
 */

/** Identity of a moved node: its part, its shape and its exact text. */
export function moveHash(part: string, type: string, rawText: string): string {
  return `${part}\u0000${type}\u0000${rawText}`;
}

export interface DetectedMove {
  /** Position in the caller's delete list. */
  readonly deleteIndex: number;
  /** Position in the caller's insert list. */
  readonly insertIndex: number;
}

/**
 * Pair deletions with insertions of identical text.
 *
 * Determinism comes from matching in list order: the first unclaimed deletion
 * takes the first unclaimed insertion of the same identity, which for
 * duplicated paragraphs means the earliest pair — a stable answer for the same
 * input, which is all the requirement asks.
 */
export function detectMoves(
  deletes: readonly string[],
  inserts: readonly string[],
): {
  readonly moves: readonly DetectedMove[];
  readonly deleted: readonly number[];
  readonly inserted: readonly number[];
} {
  const byHash = new Map<string, number[]>();
  inserts.forEach((hash, index) => {
    const bucket = byHash.get(hash);
    if (bucket === undefined) byHash.set(hash, [index]);
    else bucket.push(index);
  });
  const moves: DetectedMove[] = [];
  const deleted: number[] = [];
  deletes.forEach((hash, index) => {
    const match = byHash.get(hash)?.shift();
    if (match === undefined) {
      deleted.push(index);
      return;
    }
    moves.push({ deleteIndex: index, insertIndex: match });
  });
  const claimed = new Set(moves.map((move) => move.insertIndex));
  const inserted = inserts
    .map((_hash, index) => index)
    .filter((index) => !claimed.has(index));
  return { moves, deleted, inserted };
}
