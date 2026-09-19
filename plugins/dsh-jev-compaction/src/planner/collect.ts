/**
 * Candidate collection and pinning (SPEC §9).
 *
 * Only current model-visible `tool/result` surface nodes with text-only
 * content can become candidates. System/user/assistant nodes, the newest
 * surface window (by position and by measured tokens), the current turn,
 * error results, structurally ambiguous pairs and non-text shapes are all
 * pinned and never scored.
 */

import type { Session, SessionSeq } from "@deepseek-ai/dsh-session";
import type { ToolCallInfo } from "../dsh/surface.js";
import {
  buildCallIndex,
  hasOnlyTextBlocks,
  readSurfaceEvents,
} from "../dsh/surface.js";
import { PRUNED_BY } from "../mutation/render.js";
import type { ResolvedJevCompactionConfig } from "../config.js";

/** Normalized candidate model (SPEC §9.2) — no DSH event shapes. */
export interface ToolResultCandidate {
  /** Seq of the current surface node backing this candidate. */
  surfaceSeq: SessionSeq;
  callId: string;
  toolName?: string;
  turn: number;
  step: number;
  originalText: string;
  originalChars: number;
  isError: boolean;
  /** Surface position from the tail (0 = newest surface node). */
  agePositions: number;
  toolArgumentsPreview?: string;
}

/** Result of one collection pass. */
export interface CollectedCandidates {
  /** Eligible candidates in surface order (oldest first). */
  readonly candidates: ToolResultCandidate[];
  /** Tool/call index for the session log (state building). */
  readonly callIndex: Map<string, ToolCallInfo>;
  /** Highest turn number seen on the surface (the current turn). */
  readonly currentTurn: number;
}

/** Raw structural view of a `tool/result` event used during collection. */
interface RawResultEvent {
  seq: SessionSeq;
  turn: number;
  step: number;
  callId: string | undefined;
  isError: boolean;
  text: string;
  textOnly: boolean;
}

function readRawResult(
  event: ReturnType<typeof readSurfaceEvents>[number],
): RawResultEvent | undefined {
  if (event.type !== "tool/result") return undefined;
  const data = event.data as {
    turn: number;
    step: number;
    message: {
      source: { callId: string };
      content: [
        {
          toolCallId: string;
          isError?: boolean;
          content: { type: string; text?: string }[];
        },
      ];
    };
  };
  const block = data.message.content[0];
  if (block === undefined || block.toolCallId !== data.message.source.callId)
    return undefined;
  const textOnly = block.content.every((inner) => inner.type === "text");
  const text = block.content
    .filter(
      (inner): inner is { type: "text"; text: string } => inner.type === "text",
    )
    .map((inner) => inner.text)
    .join("\n");
  return {
    seq: event.seq,
    turn: data.turn,
    step: data.step,
    callId: data.message.source.callId,
    isError: block.isError === true,
    text,
    textOnly,
  };
}

function argumentsPreview(
  info: ToolCallInfo | undefined,
  limit: number,
): string | undefined {
  if (info === undefined || limit <= 0) return undefined;
  const raw = info.arguments;
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return raw.length <= limit ? raw : `${raw.slice(0, Math.max(0, limit - 1))}…`;
}

/**
 * Collect eligible candidates from one stable surface read.
 *
 * @param nodeTokens optional per-node heuristic token prices; used to extend
 *   the recent pin from the tail by `preserve.recentTokens`.
 */
export function collectCandidates(
  session: Session,
  config: ResolvedJevCompactionConfig,
  nodeTokens?: Map<number, number>,
): CollectedCandidates {
  const surfaceEvents = readSurfaceEvents(session);
  const callIndex = buildCallIndex(session);

  // The recent position pin: surface positions at or above this index are
  // never candidates.
  const positionPinFrom = Math.max(
    0,
    surfaceEvents.length - config.preserve.recentMessages,
  );

  // The recent token pin: walk from the tail until the token budget is
  // exhausted; every node inside that window is pinned.
  let tokenPinFrom = surfaceEvents.length;
  if (nodeTokens !== undefined && config.preserve.recentTokens > 0) {
    let budget = config.preserve.recentTokens;
    for (let index = surfaceEvents.length - 1; index >= 0; index -= 1) {
      const price = nodeTokens.get(surfaceEvents[index]!.seq) ?? 0;
      if (budget < price) break;
      budget -= price;
      tokenPinFrom = index;
    }
  }
  const pinFrom = Math.min(positionPinFrom, tokenPinFrom);

  let currentTurn = 0;
  for (const event of surfaceEvents) {
    const turn = (event.data as { turn?: number }).turn;
    if (typeof turn === "number" && turn > currentTurn) currentTurn = turn;
  }

  const candidates: ToolResultCandidate[] = [];
  const total = surfaceEvents.length;
  for (let index = 0; index < total; index += 1) {
    const raw = readRawResult(surfaceEvents[index]!);
    if (raw === undefined) continue;
    // Recent window (position or measured tokens), current turn, errors,
    // ambiguous pairs and non-text shapes are all pinned (SPEC §9.1).
    if (index >= pinFrom) continue;
    if (raw.turn >= currentTurn && currentTurn > 0) continue;
    if (config.preserve.errors && raw.isError) continue;
    if (raw.callId === undefined || !raw.textOnly) continue;
    if (!callIndex.has(raw.callId)) continue;
    // Already-pruned nodes (our own stub/truncate markers) are pinned so
    // repeated runs converge instead of re-pruning the marker.
    if (raw.text.includes(PRUNED_BY)) continue;
    const info = callIndex.get(raw.callId)!;
    candidates.push({
      surfaceSeq: raw.seq,
      callId: raw.callId,
      toolName: info.name,
      turn: raw.turn,
      step: raw.step,
      originalText: raw.text,
      originalChars: Array.from(raw.text).length,
      isError: raw.isError,
      agePositions: total - 1 - index,
      toolArgumentsPreview: argumentsPreview(info, config.state.toolInputChars),
    });
  }
  return { candidates, callIndex, currentTurn };
}

/** Convenience: candidates carry text-only content by construction. */
export function isCandidateMutable(
  session: Session,
  candidate: ToolResultCandidate,
): boolean {
  const event = session.eventAt(candidate.surfaceSeq);
  return (
    event !== undefined &&
    event.type === "tool/result" &&
    hasOnlyTextBlocks(event)
  );
}
