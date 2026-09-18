/**
 * One matcher for both halves of the slash catalog.
 *
 * Upstream matches skills with `startsWith` and commands fuzzily, so the same
 * query behaves differently depending on which registry answers it. QA always
 * ranks with the ladder below, in this order:
 *
 *   exact → prefix → name-token boundary → substring → ordered subsequence
 *
 * so `/tkp` finds `generate-tkp` through the token boundary and `/contract`
 * finds both `contract-analysis` (prefix) and `review-contract` (token).
 *
 * Dependency-free on purpose: inlined into the browser bundle.
 */

/** How a name matched; lower is a stronger claim on the top of the list. */
export const SLASH_MATCH_EXACT = 0;
export const SLASH_MATCH_PREFIX = 1;
export const SLASH_MATCH_TOKEN = 2;
export const SLASH_MATCH_SUBSTRING = 3;
export const SLASH_MATCH_SUBSEQUENCE = 4;

/** Word separators the name grammars use, for the token-boundary rung. */
const TOKEN_BREAK = /[-_]/u;

export interface QaSlashMatch {
  readonly rank: number;
  /** Where the match starts; earlier wins inside one rank. */
  readonly index: number;
}

export interface QaSlashMatchOptions {
  /**
   * Whether the two weakest rungs run. Turning them off keeps the matcher
   * predictable for deployments that read the palette as an index.
   */
  readonly fuzzy?: boolean;
}

function tokenIndexOf(name: string, query: string): number | undefined {
  let start = 0;
  for (const token of name.split(TOKEN_BREAK)) {
    if (token.startsWith(query)) return start;
    start += token.length + 1;
  }
  return undefined;
}

/** Greedy ordered-subsequence scan; the index is where the run starts. */
function subsequenceIndexOf(name: string, query: string): number | undefined {
  let cursor = 0;
  let first = -1;
  for (const character of query) {
    const found = name.indexOf(character, cursor);
    if (found === -1) return undefined;
    if (first === -1) first = found;
    cursor = found + 1;
  }
  return first === -1 ? undefined : first;
}

/**
 * Rank one name against a palette query. An empty query matches everything at
 * the prefix rung, which keeps the unfiltered catalog in catalog order.
 */
export function matchSlashName(
  name: string,
  query: string,
  options: QaSlashMatchOptions = {},
): QaSlashMatch | undefined {
  const target = name.toLowerCase();
  const needle = query.toLowerCase();
  if (needle === "") return { rank: SLASH_MATCH_PREFIX, index: 0 };
  if (target === needle) return { rank: SLASH_MATCH_EXACT, index: 0 };
  if (target.startsWith(needle)) return { rank: SLASH_MATCH_PREFIX, index: 0 };
  const token = tokenIndexOf(target, needle);
  if (token !== undefined) return { rank: SLASH_MATCH_TOKEN, index: token };
  if (options.fuzzy === false) return undefined;
  const substring = target.indexOf(needle);
  if (substring !== -1) {
    return { rank: SLASH_MATCH_SUBSTRING, index: substring };
  }
  const subsequence = subsequenceIndexOf(target, needle);
  if (subsequence !== undefined) {
    return { rank: SLASH_MATCH_SUBSEQUENCE, index: subsequence };
  }
  return undefined;
}

/**
 * Order two ranked names; the caller has already ruled out `undefined`. Ties
 * fall back to the name, so equal-rank rows keep catalog order and the list
 * never reshuffles between two renders of the same query.
 */
export function compareSlashMatches(
  leftName: string,
  left: QaSlashMatch,
  rightName: string,
  right: QaSlashMatch,
): number {
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.index !== right.index) return left.index - right.index;
  return leftName.localeCompare(rightName);
}

/**
 * The matching entries in rank order. Identity of the input entries is
 * preserved, so a caller can render them without a lookup.
 */
export function rankSlashEntries<T extends { readonly name: string }>(
  entries: readonly T[],
  query: string,
  options: QaSlashMatchOptions = {},
): readonly T[] {
  const ranked: { readonly entry: T; readonly match: QaSlashMatch }[] = [];
  for (const entry of entries) {
    const match = matchSlashName(entry.name, query, options);
    if (match !== undefined) ranked.push({ entry, match });
  }
  ranked.sort((left, right) =>
    compareSlashMatches(
      left.entry.name,
      left.match,
      right.entry.name,
      right.match,
    ),
  );
  return Object.freeze(ranked.map(({ entry }) => entry));
}
