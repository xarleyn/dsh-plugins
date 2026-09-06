import type { SessionEvent, SessionHeader } from "@deepseek-ai/dsh-session";
import type { CorrectionEvidence } from "../types.js";
import { extractCorrectionEvidence, type ContextLimits } from "./context-extractor.js";
import { isDirectUserMessage, messageText } from "./message-text.js";
import { prefilterCorrection } from "./prefilter.js";

export interface SessionSnapshot {
  readonly session: SessionHeader;
  readonly events: readonly SessionEvent[];
}

export interface SessionScanResult {
  readonly evidence: readonly CorrectionEvidence[];
  readonly eventsScanned: number;
  readonly capturedThroughSeq: number | null;
}

export function scanSession(
  snapshot: SessionSnapshot,
  afterSeq: number,
  limits: ContextLimits,
): SessionScanResult {
  const evidence: CorrectionEvidence[] = [];
  let eventsScanned = 0;
  for (let index = 0; index < snapshot.events.length; index += 1) {
    const event = snapshot.events[index];
    if (event === undefined || event.seq <= afterSeq) continue;
    eventsScanned += 1;
    if (event.type !== "user/message" || !isDirectUserMessage(event.data)) continue;
    const prefilter = prefilterCorrection(messageText(event.data));
    if (!prefilter.matched) continue;
    evidence.push(extractCorrectionEvidence(snapshot.session, snapshot.events, index, prefilter, limits));
  }
  return {
    evidence,
    eventsScanned,
    capturedThroughSeq: snapshot.events.at(-1)?.seq ?? null,
  };
}
