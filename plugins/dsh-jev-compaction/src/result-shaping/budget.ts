/**
 * Per-turn shaping budget (result-shaping SPEC §29-§31).
 *
 * Tool calls settle in parallel and out of order, so the budget is keyed by
 * the session and the turn number read from the session log — never by
 * wall-clock order. The map is bounded and pruned on every consume, so a long
 * process cannot accumulate one entry per conversation forever.
 */

import type { Session } from "@deepseek-ai/dsh-session";

import type { ResolvedJevCompactionConfig } from "../config.js";

interface TurnUsage {
  turn: number;
  requests: number;
  chars: number;
}

/** Cap on tracked sessions; the oldest-inserted key is evicted first. */
export const MAX_TRACKED_SESSIONS = 64;

/**
 * The turn number of the newest logged event, read from the end of the log so
 * the usual case is a couple of iterations.
 */
export function latestTurn(session: Session): number | undefined {
  const events = session.snapshotEvents();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const turn = (events[index]!.data as { turn?: unknown }).turn;
    if (typeof turn === "number" && Number.isFinite(turn)) return turn;
  }
  return undefined;
}

export class TurnShapeBudget {
  private readonly usage = new Map<string, TurnUsage>();

  /**
   * Reserve budget for one shaping request. Returns false when the turn has
   * already spent `maxPerTurn` requests or `maxInputCharsPerTurn` characters —
   * in which case the result is kept as it is.
   */
  tryConsume(
    sessionId: string,
    turn: number | undefined,
    chars: number,
    config: ResolvedJevCompactionConfig,
  ): boolean {
    const shaping = config.resultShaping;
    if (shaping.maxPerTurn <= 0) return false;

    const key = sessionId.length > 0 ? sessionId : "(unknown)";
    const effectiveTurn = turn ?? this.usage.get(key)?.turn ?? 0;
    let entry = this.usage.get(key);
    if (entry === undefined || entry.turn !== effectiveTurn) {
      entry = { turn: effectiveTurn, requests: 0, chars: 0 };
      this.usage.set(key, entry);
    }
    const nextChars = entry.chars + chars;
    if (entry.requests >= shaping.maxPerTurn) return false;
    if (
      shaping.maxInputCharsPerTurn > 0 &&
      nextChars > shaping.maxInputCharsPerTurn
    ) {
      return false;
    }
    entry.requests += 1;
    entry.chars = nextChars;
    this.prune();
    return true;
  }

  /** Forget the usage of every session whose turn has moved on. */
  forget(sessionId: string): void {
    this.usage.delete(sessionId);
  }

  reset(): void {
    this.usage.clear();
  }

  /** Bound the map: evict the least recently inserted session past the cap. */
  private prune(): void {
    if (this.usage.size <= MAX_TRACKED_SESSIONS) return;
    const excess = this.usage.size - MAX_TRACKED_SESSIONS;
    let removed = 0;
    for (const key of this.usage.keys()) {
      this.usage.delete(key);
      removed += 1;
      if (removed >= excess) break;
    }
  }
}
