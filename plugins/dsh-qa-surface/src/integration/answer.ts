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

/** One request's answer, additionally attributed to the turn it came from. */
export interface QaRequestAnswer extends QaTurnAnswer {
  /**
   * The harness turn number the answer was read out of, or null when the log
   * named no turn for the request's own row. The provenance bundle of a turn is
   * the evidence of its answer, so the caller cites the same number.
   */
  readonly turn: number | null;
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
  return projectTurn(ordered, (event) => event.seq > afterSeq);
}

/**
 * Project the answer of the turn one request's own prompt opened.
 *
 * The harness stamps the prompt's rpc id onto the durable user row it claims,
 * so the row is found by id rather than guessed from the newest human message:
 * two questions in flight on one chat open two turns, and a selection by
 * "latest" answers each caller with the other's turn. The turn that answers a
 * request is the one its row was claimed into — `turn/start` opens a turn and
 * the claimed rows follow it — so the answer is read out of that turn's
 * assistant messages only, and its number travels with it for the citation.
 *
 * @param events - durable events, in any order.
 * @param requestId - the rpc id the prompt was submitted with.
 * @returns the answer of this request's turn, or `undefined` when the log
 * holds no row for the request (an unflushed prompt, or a harness that does not
 * echo the id), which leaves the choice of cursor to the caller.
 */
export function answerForRequest(
  events: readonly StoredSessionEvent[],
  requestId: string,
): QaRequestAnswer | undefined {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  let promptSeq: number | undefined;
  let turn: number | undefined;
  for (const event of ordered) {
    if (promptSeq !== undefined) break;
    if (event.type === "turn/start") {
      const data = record(event.data);
      if (typeof data?.turn === "number") turn = data.turn;
    } else if (isPromptOf(event, requestId)) {
      promptSeq = event.seq;
    }
  }
  if (promptSeq === undefined) return undefined;
  const ownSeq = promptSeq;
  if (turn === undefined) {
    // A row with no `turn/start` before it: the answer is whatever this prompt
    // and the next human one bracket — the window the turn would have been.
    let next = Number.POSITIVE_INFINITY;
    for (const event of ordered) {
      if (event.seq > ownSeq && isHumanPrompt(event) && event.seq < next) {
        next = event.seq;
      }
    }
    const bounded = projectTurn(
      ordered,
      (event) => event.seq > ownSeq && event.seq < next,
    );
    return Object.freeze({ ...bounded, turn: null });
  }
  const numbered = turn;
  const projected = projectTurn(
    ordered,
    (event) => event.seq > ownSeq && record(event.data)?.turn === numbered,
  );
  return Object.freeze({ ...projected, turn: numbered });
}

/** Project one turn's answer out of the assistant messages it committed. */
function projectTurn(
  ordered: readonly StoredSessionEvent[],
  belongs: (event: StoredSessionEvent) => boolean,
): QaTurnAnswer {
  let answer = "";
  let seq: number | null = null;
  let lastWasInterrupted = false;
  for (const event of ordered) {
    if (event.type !== "assistant/message" || !belongs(event)) continue;
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

/** The producing source of one durable message row, when it has one. */
function sourceOf(
  event: StoredSessionEvent,
): Record<string, unknown> | undefined {
  return record(record(event.data)?.source);
}

/** Whether one row is a human prompt, as opposed to injected context. */
function isHumanPrompt(event: StoredSessionEvent): boolean {
  return event.type === "user/message" && sourceOf(event)?.kind === "user";
}

/**
 * Whether one row is the prompt submitted under `requestId`. The harness copies
 * the prompt's rpc id onto its source, which is what ties a durable row back to
 * the caller that wrote it.
 */
function isPromptOf(event: StoredSessionEvent, requestId: string): boolean {
  return isHumanPrompt(event) && sourceOf(event)?.rpcId === requestId;
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
    if (isHumanPrompt(event) && event.seq > seq) seq = event.seq;
  }
  return seq;
}
