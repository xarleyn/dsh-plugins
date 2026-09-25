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
 * `seen` is the caller's per-page map of the last state read. A chat is
 * reported only after this page watched it run and then watched it stop, so a
 * turn that started before the tab opened is not attributed to this user by
 * its first frame, and a chat that leaves the list leaves no notice behind.
 */
export function settleTurnCompletions(
  seen: Map<string, boolean>,
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
    const wasRunning = seen.get(chat.id);
    seen.set(chat.id, chat.running);
    if (wasRunning !== true || chat.running || paused) continue;
    completions.push({ sessionId: chat.id, title: chat.title, at: now });
  }
  return completions;
}
