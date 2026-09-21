import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { QaSessionLogReader } from "../admin/session-log.js";
import type { StoredSessionEvent } from "../admin/conversation-log.js";
import type {
  QaIntegrationMessage,
  QaIntegrationTranscript,
} from "./contract.js";
import {
  integrationMessageWindow,
  QA_INTEGRATION_MAX_TRANSCRIPT_MESSAGES,
} from "./transcript.js";

/**
 * A conversation read warm, for an application that pages through it.
 *
 * The projection itself (`transcript.ts`) answers one page from a log. That is
 * the right shape for a review page opened once and the wrong one for a caller
 * that follows a cursor: every read of a long chat would load the stored log
 * and flatten every message in it to hand back the newest fifty, so a bridge
 * paging through a two-year-old conversation pays for the whole conversation
 * per page, and pays it again on the next poll.
 *
 * What is kept here is the window itself — the newest messages, already
 * flattened — plus the newest seq below it, which is all the arithmetic a page
 * needs to be exact. A page is then either served from that window or, when the
 * window cannot answer for the caller's cursor, read from the log.
 *
 * Two things decide whether the window may be trusted:
 *
 * - **A chat this process holds is probed in memory.** The Harness is the
 *   writer, so its in-memory events answer \"has anything been appended?\" with
 *   no stored read at all, and only the appended events are projected. This is
 *   the common case: the bridge reads back the chat it just asked in.
 * - **A chat this process does not hold is trusted for a bounded time.** Nobody
 *   in this process can append to it, so the window can only be wrong about a
 *   write from somewhere else sharing the same storage — which no page read can
 *   distinguish either. The bound is deliberately the same budget the review
 *   console gives its own transcript cache, so the two answer a reviewer the
 *   same way.
 *
 * A window is never *replaced* by an in-memory snapshot, only extended from it:
 * a session that outlived a process restart, or a very long one, may hold only
 * part of its history in memory, and a read that trusted it as the whole log
 * would answer a page from half a conversation.
 *
 * What it costs: at most one window per conversation, and a window is at most
 * one maximal page — so the memory this keeps is bounded by
 * {@link QA_INTEGRATION_TRANSCRIPT_CACHE_CHATS} pages of conversation, and a
 * page a caller would have received anyway. An old chat's *first* read is still
 * a stored read, and its projection walks back only as far as the window it is
 * building: the whole log of a long conversation is never flattened to answer a
 * page of it.
 */

/** How long a window is trusted for a chat this process does not hold. */
export const QA_INTEGRATION_TRANSCRIPT_TTL_MS = 30_000;

/** How many conversations keep a warm window. */
export const QA_INTEGRATION_TRANSCRIPT_CACHE_CHATS = 128;

/** One conversation's window: the newest messages, and what lies below. */
interface QaTranscriptWindow {
  /** When the window was last known to be current; the TTL's only input. */
  at: number;
  /** Published messages, oldest first, never more than the page ceiling. */
  messages: readonly QaIntegrationMessage[];
  /**
   * The newest published seq left below the window. Undefined while the window
   * holds everything published: with it, a page's truncation is exact rather
   * than a guess, because the messages it names are the only ones a cursor
   * below the window could still be missing.
   */
  below?: number;
}

const EMPTY_MESSAGES: readonly QaIntegrationMessage[] = Object.freeze([]);

export interface QaIntegrationTranscriptReaderOptions {
  /** The deployment's conversations, as the Host reads them. */
  log: QaSessionLogReader;
  logger?: PluginLogger;
  /** Injectable clock, so the trust window is testable without waiting. */
  now?: () => number;
  ttlMs?: number;
  maxChats?: number;
  /** Ceiling on the messages a window holds; one maximal page by default. */
  maxMessages?: number;
}

export class QaIntegrationTranscriptReader {
  private readonly windows = new Map<string, QaTranscriptWindow>();
  private readonly log: QaSessionLogReader;
  private readonly logger: PluginLogger | undefined;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxChats: number;
  private readonly maxMessages: number;

  constructor(options: QaIntegrationTranscriptReaderOptions) {
    this.log = options.log;
    this.logger = options.logger;
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? QA_INTEGRATION_TRANSCRIPT_TTL_MS;
    this.maxChats = options.maxChats ?? QA_INTEGRATION_TRANSCRIPT_CACHE_CHATS;
    this.maxMessages =
      options.maxMessages ?? QA_INTEGRATION_MAX_TRANSCRIPT_MESSAGES;
  }

  /**
   * One page of a conversation, from the window when the window can answer it.
   * @param chatId - the conversation; the caller's ownership of it is the
   *   service's business, and this reader only reads it.
   * @param query - the caller's exclusive cursor and the page size it wants.
   * @returns the newest page after the cursor, with its new cursor.
   */
  async page(
    chatId: string,
    query: { readonly after: number; readonly limit: number },
  ): Promise<QaIntegrationTranscript> {
    const window = this.windows.get(chatId);
    if (window !== undefined) {
      const held = this.log.snapshot(chatId, { after: this.covered(window) });
      if (held === undefined) {
        if (this.now() - window.at < this.ttlMs) {
          return this.pageOf(chatId, window, query);
        }
      } else if (this.merge(chatId, window, held)) {
        return this.pageOf(chatId, window, query);
      }
      // Either the window aged out, or it met a chat whose new events it cannot
      // absorb: both are answered from the log rather than from memory.
    }
    return await this.readLog(chatId, query);
  }

  /** One page out of a window: exact, whatever the caller's cursor is. */
  private pageOf(
    chatId: string,
    window: QaTranscriptWindow,
    query: { readonly after: number; readonly limit: number },
  ): QaIntegrationTranscript {
    const limit = Math.min(query.limit, this.maxMessages);
    const inside = window.messages.filter((message) => message.seq > query.after);
    const messages =
      inside.length > limit ? inside.slice(inside.length - limit) : inside;
    // A caller whose cursor fell below the window still gets the newest page —
    // its answer is the window's tail — but there are messages it has not seen
    // below the window, and that is what truncation reports.
    const older = window.below !== undefined && window.below > query.after;
    return Object.freeze({
      chatId,
      messages: Object.freeze([...messages]),
      lastSeq: messages.at(-1)?.seq ?? query.after,
      truncated: older || inside.length > limit,
    });
  }

  /**
   * Fold what the Harness is holding into a window, projecting only the events
   * the window has not covered yet.
   * @returns whether the window absorbed the update; false means the delta is
   *   larger than a whole window, so the log has to answer instead.
   */
  private merge(
    chatId: string,
    window: QaTranscriptWindow,
    events: readonly StoredSessionEvent[],
  ): boolean {
    const delta = integrationMessageWindow(chatId, events, {
      after: this.covered(window),
      cover: this.maxMessages,
    });
    if (delta.messages.length === 0) {
      // Nothing was appended, and the window is current as of now.
      window.at = this.now();
      return true;
    }
    const combined = [...window.messages, ...delta.messages];
    if (combined.length > this.maxMessages) return false;
    window.messages = Object.freeze(combined);
    if (delta.below !== undefined) {
      // The newest seq left below the *window*: the delta's own cut is newer
      // than anything the previous window had already left behind.
      window.below = delta.below;
    }
    window.at = this.now();
    return true;
  }

  /**
   * The newest published seq a window has covered, which is also the cursor a
   * probe is asked from: `undefined` while the window holds nothing, where the
   * question is "what has this chat published at all".
   */
  private covered(window: QaTranscriptWindow): number | undefined {
    return window.messages.at(-1)?.seq;
  }

  /** Read the log and remember what it says, for the pages that follow. */
  private async readLog(
    chatId: string,
    query: { readonly after: number; readonly limit: number },
  ): Promise<QaIntegrationTranscript> {
    const read = await this.log.read(chatId);
    if (!read.ok) {
      this.windows.delete(chatId);
      if (read.reason === "not-found") {
        // The ownership record is written before the first message, so a chat
        // that exists but has written nothing is an empty conversation rather
        // than a failure. Nothing is remembered: it may write any moment.
        return Object.freeze({
          chatId,
          messages: EMPTY_MESSAGES,
          lastSeq: query.after,
          truncated: false,
        });
      }
      throw new Error(`the session log is unavailable (${read.reason})`);
    }
    const base = integrationMessageWindow(chatId, read.events, {
      after: undefined,
      cover: this.maxMessages,
    });
    const window: QaTranscriptWindow = {
      at: this.now(),
      messages: base.messages,
      ...(base.below === undefined ? {} : { below: base.below }),
    };
    // Storage lags the session it belongs to, so a chat this process holds is
    // extended with what memory has already: the alternative is answering a
    // page with a turn the Harness has written but not flushed.
    const held = this.log.snapshot(chatId, { after: this.covered(window) });
    if (held !== undefined && !this.merge(chatId, window, held)) {
      // A window cannot hold more than a page, and a chat that wrote more than
      // that between two reads is read rather than merged. The window is still
      // exact for its own messages; the newest ones arrive with the next read.
      this.logger?.warn("integration.transcript-window-behind", {
        chatId,
        below: window.below,
      });
    }
    this.remember(chatId, window);
    return this.pageOf(chatId, window, query);
  }

  /** Keep a bounded number of conversations warm, oldest window first. */
  private remember(chatId: string, window: QaTranscriptWindow): void {
    this.windows.set(chatId, window);
    while (this.windows.size > this.maxChats) {
      let oldestId: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [id, entry] of this.windows) {
        if (entry.at < oldestAt) {
          oldestAt = entry.at;
          oldestId = id;
        }
      }
      if (oldestId === undefined) return;
      this.windows.delete(oldestId);
    }
  }
}
