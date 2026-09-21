import { messageContentText } from "../admin/conversation-log.js";
import type { StoredSessionEvent } from "../admin/conversation-log.js";

/**
 * Reading one answered turn out of a session log.
 *
 * The log is the durable record of the conversation, and it is what the
 * integration API publishes: the live assistant stream is a presentation
 * channel that can be abandoned mid-attempt, while `assistant/message` events
 * are what was actually committed. A turn with tools in it commits several
 * assistant messages — the intermediate steps carry tool calls and usually no
 * prose — so the answer is the *last one that has text*, not simply the last
 * one written. If a later empty message follows a text one, publishing the
 * empty message would answer the bridge with nothing.
 */

/** The answer of one settled turn, plus how the turn ended. */
export interface QaTurnAnswer {
  /** The publishable text; empty when the turn committed no prose at all. */
  readonly answer: string;
  /** True when the last committed assistant message was interrupted. */
  readonly interrupted: boolean;
  /** Durable seq of the message the answer came from, when there was one. */
  readonly seq: number | null;
}

/** The empty answer: what a turn that committed nothing readable looks like. */
export const QA_EMPTY_ANSWER: QaTurnAnswer = Object.freeze({
  answer: "",
  interrupted: false,
  seq: null,
});

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Project the answer of the turn that starts after `afterSeq`.
 *
 * Only events after the caller's own prompt are read: a chat is continued
 * across questions, and picking the last assistant message of the whole log
 * would hand question #2 the answer to question #1 whenever the new turn
 * committed nothing.
 *
 * @param events - durable events, in any order.
 * @param afterSeq - the seq of the prompt whose answer is wanted.
 * @returns the publishable answer and whether the turn was interrupted.
 */
export function answerAfter(
  events: readonly StoredSessionEvent[],
  afterSeq: number,
): QaTurnAnswer {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  let answer = "";
  let seq: number | null = null;
  let lastWasInterrupted = false;
  for (const event of ordered) {
    if (event.type !== "assistant/message" || event.seq <= afterSeq) continue;
    const data = record(event.data);
    const message = record(data?.message);
    lastWasInterrupted = data?.interrupted === true;
    const text = messageContentText(message?.content).trim();
    if (text === "") continue;
    answer = text;
    seq = event.seq;
  }
  return Object.freeze({ answer, interrupted: lastWasInterrupted, seq });
}

/**
 * Cut an answer down to the size the caller publishes.
 *
 * The bridge posts the answer into a ticket comment, which has a size budget
 * of its own: an over-long comment is not rejected there, it is cut — and a cut
 * that lands in the middle of a sentence, or worse inside a code block, reads
 * like a broken answer. The cut therefore prefers the last paragraph break,
 * then the last line, then the last sentence, and only then an arbitrary word
 * boundary, and it appends an ellipsis so the reader sees that text is missing
 * rather than finished. A boundary that would leave less than half the budget
 * used is refused: a single early paragraph break must not turn a full answer
 * into one line.
 * @param answer - the settled answer, already trimmed.
 * @param maxCharacters - the publish budget; a non-positive value never cuts.
 * @returns the answer, or its bounded head.
 */
export function boundAnswer(answer: string, maxCharacters: number): string {
  if (maxCharacters <= 0 || answer.length <= maxCharacters) return answer;
  // The ellipsis itself is part of the budget, so a cut answer still fits in
  // the limit the operator configured.
  const head = answer.slice(0, maxCharacters - 1);
  const floor = Math.floor(head.length / 2);
  let kept = head;
  for (const separator of ["\n\n", "\n", ". ", " "]) {
    const at = head.lastIndexOf(separator);
    if (at >= floor) {
      kept = head.slice(0, separator === ". " ? at + 1 : at);
      break;
    }
  }
  return `${kept.replace(/\s+$/u, "")}…`;
}

/**
 * The seq of the newest user-authored message in a log, which is the floor
 * `answerAfter` reads from when the caller has just submitted a prompt.
 * Synthetic context (injected notes, skill payloads) is skipped: it is model
 * input recorded as a user message, and one arriving after the answer would
 * otherwise hide it.
 * @param events - durable events, in any order.
 * @returns the seq, or 0 when the log holds no human prompt yet.
 */
export function lastPromptSeq(events: readonly StoredSessionEvent[]): number {
  let seq = 0;
  for (const event of events) {
    if (event.type !== "user/message") continue;
    const data = record(event.data);
    const source = record(data?.source);
    if (source?.kind !== "user") continue;
    if (event.seq > seq) seq = event.seq;
  }
  return seq;
}
