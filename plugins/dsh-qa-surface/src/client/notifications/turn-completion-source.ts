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
 * vouch for. A frame read while the link was down settles neither fact, but the
 * way `running` pointed in it still decides what this page is short of: the
 * start of a run it cannot account for, or an idle reading it cannot yet trust.
 */
export type QaTurnSighting =
  /**
   * Not running, read while the link held — so a run seen next is one this
   * page watches begin.
   */
  | "idle"
  /**
   * Running, and this page saw this very run begin: it held `idle` in the first
   * frame that found the chat running. The frames after that keep the reading —
   * the evidence is the witnessed start, so a run does not lose it by lasting
   * longer than one frame.
   */
  | "watched"
  /**
   * Running, with no evidence of where the run began: the page found the chat
   * running without seeing it start — which is how the page opens, and how a run
   * that outlived the link looks once the link is back. A run ending here is not
   * this reader's news.
   */
  | "unwatched"
  /**
   * Not running, but read only in frames the browser cannot vouch for: the link
   * was down when this was read, or it has returned and the chat's row has not
   * moved since. A row that has not moved is no news about now — it may well be
   * the reading the gap left behind, and this page cannot tell the two apart —
   * so it arms nothing, because a run that began inside the gap would leave it
   * exactly as it is. Only the row moving ends it.
   */
  | "stale";

export interface QaTurnCompletionOptions {
  /**
   * Re-project the baseline and report nothing. While the browser is
   * reconnecting the list it holds is stale, and the first frame after the
   * link returns would otherwise read as a batch of finished turns. This flag
   * goes back off with the link, which is sooner than the host list is read
   * again: the re-pull belongs to the host store and is not awaited, so a live
   * frame can carry the rows the drop left. What a pause costs this page is
   * therefore carried by the readings rather than by the flag — see `stale`. A
   * gap that left no frame with this flag set is named as a rule of
   * `docs/specs/owner-scoped-notifications.md` §12, not as a detail of this
   * file.
   */
  readonly paused?: boolean;
  readonly now?: number;
}

/**
 * Report the turns that ended since the previous observation of `chats`.
 *
 * The input is this reader's own rows — see {@link scopeNoticesToOwnChats},
 * which is what keeps an admin's shared history out of them — because a notice
 * is an outward report about the chat it names. The host list is the whole
 * deployment's, so anything wider than these rows would tell one user that
 * another user's turn had stopped.
 *
 * `seen` is the caller's per-page map of the last reading, and a chat is
 * reported only when a `watched` run is seen ending in a frame the browser
 * could vouch for. So the notice always tells the reader about a turn they were
 * waiting for, and never about one that was already under way when they could
 * not see it: a chat found running on the page's first frame, or in the frames
 * around a reconnect, is `unwatched`, and its end passes in silence. Nor does a
 * gap spare a run it lands inside: the paused frame takes back the evidence that
 * this page watched that run begin, because while the link was down the chat may
 * have run another turn and the rows that come back name neither. The first run
 * to end after a gap passes in silence too, in a chat whose row never moved
 * across it — the only idle this page holds for that chat was read through the
 * gap, and a run that began inside the gap would look exactly like it. That
 * reading arms nothing until the chat's own row moves, and the move that arms it
 * is a run ending: the very one this page then keeps silent about. So a turn is
 * reported only when no gap falls between the idle reading that armed this page
 * and the frame that sees the run end, which is why a run begun and finished on
 * the recovered link can still pass unreported, and why a gap costs a chat one
 * turn — or two, where a turn ended inside the gap. The turn that a link which
 * held carries from an armed idle to its end is the page's own, so a page that
 * stays open notifies again once the turn paying for the gap has ended — once
 * per turn from there.
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
  // A frame the browser cannot vouch for settles neither fact, but which way it
  // pointed decides what this page is waiting for.
  if (paused) return running ? "unwatched" : "stale";
  if (!running) {
    // The same row the gap left behind is not new information about now.
    return previous === "stale" ? "stale" : "idle";
  }
  return previous === "idle" || previous === "watched"
    ? "watched"
    : "unwatched";
}

/**
 * Keep the rows a notice may be raised for: the sidebar's rows down to the
 * chats this account owns outright.
 *
 * The sidebar is a *read* surface, and an admin's shared view is deliberately
 * wider than ownership — the same opt-in that shows another account's chat
 * must not decide whose activity this browser reports outward. A notice is
 * that outward report, and it names a chat by title, so it takes the narrow
 * list. `undefined` is the deployment with no accounts, where the browser's own
 * index already is the owned set and there is nothing narrower to ask for.
 */
export function scopeNoticesToOwnChats(
  chats: readonly QaChatActivity[],
  ownIds: readonly string[] | undefined,
): readonly QaChatActivity[] {
  if (ownIds === undefined) return chats;
  const owned = new Set(ownIds);
  return chats.filter((chat) => owned.has(chat.id));
}
