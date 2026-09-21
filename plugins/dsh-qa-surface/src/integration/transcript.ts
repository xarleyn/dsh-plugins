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
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  const messages: QaIntegrationMessage[] = [];
  for (const event of ordered) {
    if (event.seq <= query.after) continue;
    const role =
      event.type === "user/message"
        ? ("user" as const)
        : event.type === "assistant/message"
          ? ("assistant" as const)
          : undefined;
    if (role === undefined) continue;
    const text =
      role === "user" ? userTextOf(event) : assistantTextOf(event);
    if (text === undefined || text === "") continue;
    const at = atOf(event);
    messages.push(
      Object.freeze({
        seq: event.seq,
        role,
        text,
        ...(at === undefined ? {} : { at }),
      }),
    );
  }
  // The window is the newest messages: a caller asking for history wants the
  // end of the conversation, and the page it did not get is reported rather
  // than silently dropped.
  const window =
    messages.length > query.limit ? messages.slice(messages.length - query.limit) : messages;
  return Object.freeze({
    chatId,
    messages: Object.freeze(window),
    lastSeq: messages.at(-1)?.seq ?? query.after,
    truncated: window.length < messages.length,
  });
}
