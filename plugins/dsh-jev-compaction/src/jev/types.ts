/**
 * Jev vocabulary shared by the state builder, the batcher, the validator and
 * the backend. The wire contract follows TypeSafe AI's System One endpoint
 * as exercised by the upstream `fast-jev-compaction` project (see NOTICE):
 * one POST with `{ model, state, questions }` returning `{ answers }` keyed
 * by question name, each answer carrying a `noul` probability.
 */

/** One history entry of the Jev state (tool outputs replaced by notes). */
export interface JevHistoryEntry {
  /** Marker such as `user t3`, `assistant t3`, `tool t3/c1`. */
  readonly label: string;
  readonly text: string;
  /** Call id this entry belongs to, when it is tool metadata. */
  readonly callId?: string;
}

/** The derived conversational state sent with every Jev request. */
export interface JevState {
  readonly context: string;
  readonly goal: string;
  readonly history: readonly JevHistoryEntry[];
}

/** One yes/no question about one candidate. */
export interface JevQuestion {
  readonly name: string;
  readonly instructions: string;
}

/** A probability map keyed by question name (validated output). */
export type JevAnswers = Map<string, number>;

/**
 * The backend interface every decision engine implements (SPEC §18). The
 * provider-neutral name is deliberate: hosted TypeSafe Jev, a self-hosted
 * Jeff server, and any other System One-compatible endpoint all implement
 * this one contract; switching is configuration, not code.
 */
export interface SystemOneBackend {
  score(
    state: JevState,
    questions: readonly JevQuestion[],
    signal: AbortSignal | undefined,
  ): Promise<JevAnswers>;
}

/** Jev-compatible token estimate for state/request fitting. */
export function estimateStateTokens(text: string): number {
  let tokens = 0;
  for (const match of text.matchAll(/[A-Za-z]+|\d+|\s+|[^\sA-Za-z\d]/g)) {
    const piece = match[0];
    const first = piece.charCodeAt(0);
    if (first >= 48 && first <= 57) tokens += piece.length / 2;
    else if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
      tokens += 1 + Math.floor((piece.length - 1) / 6);
    } else if ((first >= 9 && first <= 13) || first === 32) {
      tokens += 0.25;
    } else tokens += 0.9;
  }
  return Math.ceil(tokens);
}
