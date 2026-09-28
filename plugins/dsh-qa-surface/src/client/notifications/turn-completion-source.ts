/** One chat of this browser's own list, as the page currently sees it. */
export interface QaChatActivity {
  readonly id: string;
  readonly title: string;
  readonly running: boolean;
}

/** One turn that ended between two observations of the chat list. */
export interface QaTurnCompletion {
  readonly sessionId: string;
  /** The chat's own display title: the only text a notice may carry. */
  readonly title: string;
  readonly at: number;
}

/**
 * What this page last read about one chat's turn. Four readings, because two
 * facts decide whether the end of a run is this reader's news: whether the chat
 * was running, and whether the frame that said so was one the browser could
 * vouch for.
 */
export type QaTurnSighting =
  /**
   * Not running, read while the link held — so a run seen next is one this
   * page watches begin.
   */
  | "idle"
  /**
   * Running, from an `idle` reading this page held in the frame before: the run
   * under way is one this page saw start.
   */
  | "watched"
  /**
   * Running, but its beginning was not seen here — found this way when the page
   * opened, or after a gap in what the browser could vouch for. Its end is not
   * this reader's news.
   */
  | "unwatched"
  /**
   * Read while the browser was reconnecting. The list is stale, so the page
   * vouches for nothing: neither a run ending in this frame nor one starting in
   * the next is evidence of anything.
   */
  | "stale";

export interface QaTurnCompletionOptions {
  /**
   * Re-project the baseline and report nothing. While the browser is
   * reconnecting the list it holds is stale, and the first frame after the
   * link returns would otherwise read as a batch of finished turns.
   */
  readonly paused?: boolean;
  readonly now?: number;
}

/**
 * Report the turns that ended since the previous observation of `chats`.
 *
 * The input is the sidebar's own rows — this browser's chat index projected
 * onto the host list — which is what scopes a notice to the person who owns
 * the chat. The host list is the whole deployment's, so anything wider than
 * these rows would tell one user that another user's turn had stopped.
 *
 * `seen` is the caller's per-page map of the last reading, and a chat is
 * reported only when a `watched` run is seen ending in a frame the browser
 * could vouch for. So the notice always tells the reader about a turn they were
 * waiting for, and never about one that was already under way when they could
 * not see it: a chat found running on the page's first frame, or in the frames
 * around a reconnect, is `unwatched`, and its end passes in silence. The run
 * the page watches start is its own: the next turn of the same chat is seen
 * beginning from the idle reading that closed this one, so a page that stays
 * open keeps notifying — once per turn.
 */
export function settleTurnCompletions(
  seen: Map<string, QaTurnSighting>,
  chats: readonly QaChatActivity[],
  options: QaTurnCompletionOptions = {},
): QaTurnCompletion[] {
  const { paused = false, now = Date.now() } = options;
  const listed = new Set(chats.map((chat) => chat.id));
  for (const id of seen.keys()) {
    if (!listed.has(id)) seen.delete(id);
  }
  const completions: QaTurnCompletion[] = [];
  for (const chat of chats) {
    const previous = seen.get(chat.id);
    if (!paused && !chat.running && previous === "watched") {
      completions.push({ sessionId: chat.id, title: chat.title, at: now });
    }
    seen.set(chat.id, readSighting(previous, chat.running, paused));
  }
  return completions;
}

function readSighting(
  previous: QaTurnSighting | undefined,
  running: boolean,
  paused: boolean,
): QaTurnSighting {
  if (paused) return "stale";
  if (!running) return "idle";
  return previous === "idle" || previous === "watched"
    ? "watched"
    : "unwatched";
}
