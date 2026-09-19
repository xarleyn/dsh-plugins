/**
 * DSH surface mechanics, isolated behind this compat layer (SPEC §24).
 *
 * Reads the current surface, indexes tool calls, validates snapshot
 * freshness, and constructs legal single-node `tool/result` replacements.
 * Every DSH-version-specific field name lives here; callers pass normalized
 * data in and get normalized data out.
 */

import { freezeMessage } from "@deepseek-ai/dsh-llm";
import type { ContentBlock, ToolResultMessage } from "@deepseek-ai/dsh-llm";
import type {
  Session,
  SessionEvent,
  SessionSeq,
  ToolResultMessage as SessionToolResultMessage,
} from "@deepseek-ai/dsh-session";
import type { SessionEventType } from "@deepseek-ai/dsh-session/types";

/** One logged event, generically typed for read-only scanning. */
export type AnySessionEvent = SessionEvent<SessionEventType>;

/** Indexed `tool/call` metadata for one session log. */
export interface ToolCallInfo {
  readonly seq: SessionSeq;
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
  readonly turn: number;
  readonly step: number;
}

/** Identity of the surface at planning time, for staleness detection. */
export interface SurfaceSnapshot {
  readonly replaceGeneration: number;
  readonly nodes: readonly SessionSeq[];
}

/** Read the ordered current surface events (one pass, no rescans). */
export function readSurfaceEvents(session: Session): AnySessionEvent[] {
  const events: AnySessionEvent[] = [];
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq);
    if (event !== undefined) events.push(event);
  }
  return events;
}

/** Index every `tool/call` in the log by callId (one pass over the log). */
export function buildCallIndex(session: Session): Map<string, ToolCallInfo> {
  const index = new Map<string, ToolCallInfo>();
  for (const event of session.snapshotEvents()) {
    if (event.type !== "tool/call") continue;
    const data = event.data as {
      callId: string;
      name: string;
      arguments: string;
      turn: number;
      step: number;
    };
    index.set(data.callId, {
      seq: event.seq,
      callId: data.callId,
      name: data.name,
      arguments: data.arguments,
      turn: data.turn,
      step: data.step,
    });
  }
  return index;
}

/** True when the result carries only text blocks (v1 mutation domain). */
export function hasOnlyTextBlocks(event: SessionEvent<"tool/result">): boolean {
  return event.data.message.content[0].content.every(
    (block) => block.type === "text",
  );
}

/** Joined text of the result's text blocks, separated by newlines. */
export function extractResultText(event: SessionEvent<"tool/result">): string {
  return event.data.message.content[0].content
    .filter(
      (block): block is ContentBlock & { type: "text"; text: string } =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

/** Capture the surface identity used to detect drift across async work. */
export function captureSurfaceSnapshot(session: Session): SurfaceSnapshot {
  return {
    replaceGeneration: session.surface.replaceGeneration,
    nodes: [...session.surface.nodes],
  };
}

/**
 * Revalidate a snapshot right before mutation: the generation must be
 * unchanged and every planned seq must still be a current `tool/result`
 * surface node with text-only blocks.
 */
export function isSnapshotFresh(
  session: Session,
  snapshot: SurfaceSnapshot,
  plannedSeqs: readonly number[],
): boolean {
  if (session.surface.replaceGeneration !== snapshot.replaceGeneration)
    return false;
  const nodes = session.surface.nodes;
  for (const seq of plannedSeqs) {
    if (!nodes.some((node) => node === (seq as SessionSeq))) return false;
    const event = session.eventAt(seq as SessionSeq);
    if (event === undefined || event.type !== "tool/result") return false;
    if (!hasOnlyTextBlocks(event)) return false;
  }
  return true;
}

/**
 * Append one replay-safe replacement for a single `tool/result` node. The
 * caller must have validated `isSnapshotFresh` immediately before. Only the
 * textual content of the first tool-result block changes; every other field
 * of the original event data is carried over verbatim, which is exactly what
 * the session's `tool/result` rewrite invariant admits.
 *
 * @returns the replacement event's seq.
 */
export function appendToolResultReplacement(
  session: Session,
  original: SessionEvent<"tool/result">,
  replacementText: string,
): SessionSeq {
  const result = original.data.message.content[0];
  const content: ContentBlock[] = [{ type: "text", text: replacementText }];
  const message = freezeMessage<SessionToolResultMessage>({
    ...original.data.message,
    content: [
      {
        ...result,
        content,
      },
    ],
  } as ToolResultMessage);
  const replacement = session.append(
    "tool/result",
    {
      ...original.data,
      message,
    },
    {
      surfaceOp: {
        op: "replace",
        startSeq: original.seq,
        endSeq: original.seq,
      },
      sourceEventSeqs: [original.seq],
    },
  );
  return replacement.seq;
}
