import { Buffer } from "node:buffer";
import type { SessionEvent, SessionHeader } from "@deepseek-ai/dsh-session";
import type { CorrectionContextEvent, CorrectionEvidence } from "../types.js";
import { sha256 } from "../utils/hashing.js";
import { isDirectUserMessage, messageText } from "./message-text.js";
import type { CorrectionPrefilterResult } from "./prefilter.js";

export interface ContextLimits {
  readonly maxContextEvents: number;
  readonly maxContextBytes: number;
}

function fitUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle), "utf8") <= Math.max(0, maxBytes - 3)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low === 0 ? "" : `${text.slice(0, low)}…`;
}

function summarize(event: SessionEvent): CorrectionContextEvent | undefined {
  switch (event.type) {
    case "user/message": {
      if (!isDirectUserMessage(event.data)) return undefined;
      return { seq: event.seq, kind: "user", text: messageText(event.data) };
    }
    case "assistant/message":
      return { seq: event.seq, kind: "assistant", text: messageText(event.data.message) };
    case "tool/call":
      return {
        seq: event.seq,
        kind: "tool-call",
        text: `${event.data.name} ${event.data.arguments}`.trim(),
      };
    case "tool/result":
      return { seq: event.seq, kind: "tool-result", text: messageText(event.data.message) };
    default:
      return undefined;
  }
}

export function extractCorrectionEvidence(
  header: SessionHeader,
  events: readonly SessionEvent[],
  correctionIndex: number,
  prefilter: CorrectionPrefilterResult,
  limits: ContextLimits,
): CorrectionEvidence {
  const correction = events[correctionIndex];
  if (correction?.type !== "user/message" || !isDirectUserMessage(correction.data)) {
    throw new TypeError("correctionIndex must point to a direct user/message event");
  }
  const userText = messageText(correction.data);
  const newestFirst: CorrectionContextEvent[] = [];
  let remainingBytes = limits.maxContextBytes;

  for (let index = correctionIndex - 1; index >= 0 && newestFirst.length < limits.maxContextEvents; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;
    const summary = summarize(event);
    if (summary === undefined) continue;
    const text = fitUtf8(summary.text, remainingBytes);
    if (text.length === 0) break;
    newestFirst.push({ ...summary, text });
    remainingBytes -= Buffer.byteLength(text, "utf8");
    if (summary.kind === "user") break;
  }

  const contextEvents = newestFirst.reverse();
  const previousUser = contextEvents.find((event) => event.kind === "user")?.seq;
  const previousAssistantEvents = contextEvents
    .filter((event) => event.kind === "assistant")
    .map((event) => event.seq);
  const previousToolEvents = contextEvents
    .filter((event) => event.kind === "tool-call" || event.kind === "tool-result")
    .map((event) => event.seq);

  return {
    sessionId: String(header.id),
    userEventSeq: correction.seq,
    userText,
    ...(previousUser === undefined ? {} : { previousUserEvent: previousUser }),
    previousAssistantEvents,
    previousToolEvents,
    contextEvents,
    contextDigest: sha256(JSON.stringify(contextEvents)),
    cwd: header.cwd ?? "",
    timestamp: correction.time,
    matchedSignals: prefilter.signals,
    likelyOneOff: prefilter.likelyOneOff,
  };
}
