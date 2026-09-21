import { messageContentText } from "../admin/conversation-log.js";
import type { StoredSessionEvent } from "../admin/conversation-log.js";
import type {
  QaIntegrationMessage,
  QaIntegrationTranscript,
} from "./contract.js";

/**
 * Reading a conversation back out of its durable log, for the application that
 * started it.
 *
 * This is deliberately not the admin viewer's projection. That one answers a
 * reviewer and carries what a review needs — tool calls, ratings, the redaction
 * policy — none of which an external caller may see or has any use for. What
 * this projector shares with the rest of the API is the flattening rule
 * (`messageContentText`): the text a caller reads here is the same text it
 * would have received as an answer, so the two never disagree about what a
 * message says.
 *
 * Only human prompts and assistant messages are published. Injected context —
 * identity notes, skill payloads, a slash command's expanded body — is model
 * input recorded as a user message, and handing it back would show the caller
 * instructions it never wrote. Tool traffic is model plumbing: the answer is
 * already the result of it.
 */

/** Newest messages one read returns; more than a page is a different tool. */
export const QA_INTEGRATION_MAX_TRANSCRIPT_MESSAGES = 200;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Whether an `assistant/message` event's payload carries text worth publishing. */
function assistantTextOf(event: StoredSessionEvent): string {
  const data = record(event.data);
  return messageContentText(record(data?.message)?.content).trim();
}

/** Whether a `user/message` event is something the person actually sent. */
function userTextOf(event: StoredSessionEvent): string | undefined {
  const data = record(event.data);
  const source = record(data?.source);
  if (source?.kind !== "user") return undefined;
  const text = messageContentText(data?.content).trim();
  return text === "" ? undefined : text;
}

/** The ISO timestamp of an event the log gave a time, when it gave a usable one. */
function atOf(event: StoredSessionEvent): string | undefined {
  if (event.time === undefined || !Number.isFinite(event.time)) return undefined;
  return new Date(event.time).toISOString();
}

/** Whether the events already arrive in ascending seq order. */
function isOrderedBySeq(events: readonly StoredSessionEvent[]): boolean {
  for (let index = 1; index < events.length; index += 1) {
    if ((events[index] as StoredSessionEvent).seq < (events[index - 1] as StoredSessionEvent).seq) {
      return false;
    }
  }
  return true;
}

/** One message's published form, or nothing when the event has none. */
function messageOf(event: StoredSessionEvent): QaIntegrationMessage | undefined {
  const role =
    event.type === "user/message"
      ? ("user" as const)
      : event.type === "assistant/message"
        ? ("assistant" as const)
        : undefined;
  if (role === undefined) return undefined;
  const text = role === "user" ? userTextOf(event) : assistantTextOf(event);
  if (text === undefined || text === "") return undefined;
  const at = atOf(event);
  return Object.freeze({
    seq: event.seq,
    role,
    text,
    ...(at === undefined ? {} : { at }),
  });
}

/**
 * The newest published messages of a log, and what was left below them.
 *
 * This is the primitive both readers are built on, and it walks the events
 * **newest first**: a page of a hundred-message conversation costs a hundred
 * messages flattened, not the whole log, which is what makes a long chat's
 * page cheap. Only the events below the cursor are considered, and the walk
 * stops as soon as the window is full — the one message after that is enough
 * to know that more exists, and `below` records its seq.
 *
 * @param chatId - the conversation being read; echoed back for correlation.
 * @param events - the log's events, in any order.
 * @param query - the cursor (exclusive) and how many messages to cover; the
 *   cursor is `undefined` for "from the end", which a warm window asks for.
 * @returns the window, oldest first, and the newest seq left below it.
 */
export function integrationMessageWindow(
  chatId: string,
  events: readonly StoredSessionEvent[],
  query: {
    readonly after: number | undefined;
    readonly cover: number;
  },
): {
  readonly chatId: string;
  readonly messages: readonly QaIntegrationMessage[];
  readonly below: number | undefined;
} {
  // The order a log is written in is the order it is stored and read in, so
  // sorting is the exception: a caller that handed over events from somewhere
  // else (a test, a fixture) is the only one that pays for it. Checking costs
  // one pass, and the walk below is the one that allocates.
  const ordered = isOrderedBySeq(events)
    ? events
    : [...events].sort((left, right) => left.seq - right.seq);
  const messages: QaIntegrationMessage[] = [];
  let below: number | undefined;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const event = ordered[index] as StoredSessionEvent;
    if (query.after !== undefined && event.seq <= query.after) break;
    const message = messageOf(event);
    if (message === undefined) continue;
    if (messages.length >= query.cover) {
      // One message past the window is all the cursor needs to say "there is
      // more below": it is the newest of the messages this window left out.
      below = message.seq;
      break;
    }
    messages.push(message);
  }
  messages.reverse();
  return Object.freeze({
    chatId,
    messages: Object.freeze(messages),
    below,
  });
}

/**
 * Project the log into one page of a caller's transcript.
 *
 * @param chatId - the conversation being read; echoed back for correlation.
 * @param events - durable events, in any order.
 * @param query - the caller's cursor and page size; both are already bounded.
 * @returns the window with the caller's new cursor.
 */
export function projectIntegrationTranscript(
  chatId: string,
  events: readonly StoredSessionEvent[],
  query: {
    readonly after: number;
    readonly limit: number;
  },
): QaIntegrationTranscript {
  // The window is the newest messages: a caller asking for history wants the
  // end of the conversation, and the page it did not get is reported rather
  // than silently dropped.
  const window = integrationMessageWindow(chatId, events, {
    after: query.after,
    cover: query.limit,
  });
  return Object.freeze({
    chatId,
    messages: window.messages,
    lastSeq: window.messages.at(-1)?.seq ?? query.after,
    truncated: window.below !== undefined,
  });
}
