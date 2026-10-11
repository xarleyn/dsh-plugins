import type { StoredSessionEvent } from "./admin/conversation-log.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Resolve a selected durable answer to the end of its completed turn. */
export function qaForkBoundary(
  events: readonly StoredSessionEvent[],
  answerSeq: number,
): {
  readonly atSeq: number;
  readonly turn: number;
} {
  if (!Number.isSafeInteger(answerSeq) || answerSeq < 0)
    throw new Error("Fork requires a durable answer position.");
  const selected = events.find((event) => event.seq === answerSeq);
  const data = record(selected?.data);
  const turn = data?.turn;
  const content = record(data?.message)?.content;
  if (
    selected?.type !== "assistant/message" ||
    typeof turn !== "number" ||
    !Array.isArray(content) ||
    !content.some(
      (part) =>
        record(part)?.type === "text" &&
        typeof record(part)?.text === "string" &&
        String(record(part)?.text).trim() !== "",
    )
  )
    throw new Error("Fork requires a committed text answer.");
  for (const event of events) {
    if (event.seq <= answerSeq) continue;
    const next = record(event.data);
    if (event.type === "turn/start" || event.type === "user/message") break;
    if (event.type === "assistant/message" && next?.turn === turn)
      throw new Error("Fork requires the final answer of the turn.");
    if (event.type === "turn/end" && next?.turn === turn)
      return { atSeq: event.seq, turn };
  }
  throw new Error("The selected answer's turn has not completed.");
}
