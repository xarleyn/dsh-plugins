import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { LegacyConversationSlice } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { QaSource, QaTurnSources } from "../types.js";
import { QaSourceCollector } from "../provenance/collector.js";
import { createDefaultSourceExtractorRegistry } from "../provenance/extractors.js";

/** Empty Chat slice matching the host's EMPTY_CHAT_SNAPSHOT, without a value import. */
const EMPTY_LEGACY: LegacyConversationSlice = Object.freeze({
  nodes: Object.freeze([]),
  turnTimings: new Map(),
  turnEnds: new Map(),
  partial: null,
  runningCalls: Object.freeze([]),
});

/** The transcript-bearing Chat slice of one Conversation snapshot (absent before the view activates). */
export function chatLegacyOf(
  snapshot: ConversationSnapshot | undefined,
): LegacyConversationSlice {
  return snapshot?.views.get("chat")?.legacy ?? EMPTY_LEGACY;
}

const DEFAULT_SOURCE_EXTRACTORS = createDefaultSourceExtractorRegistry();

interface SourceCallHead {
  readonly turn: number;
  readonly step: number;
  readonly name: string;
  readonly argsRaw: string;
}

/**
 * Rebuild canonical turn bundles from durable tool-result metadata. Since the
 * metadata is persisted by DSH, this projection is identical on live updates
 * and replay and requires no assistant-authored bibliography.
 */
export function projectTurnSources(
  snapshot: ConversationSnapshot | undefined,
  sessionId = "unknown",
  workspaceRoot?: string,
): readonly QaTurnSources[] {
  const legacy = chatLegacyOf(snapshot);
  const heads = new Map<string, SourceCallHead>();
  for (const node of legacy.nodes) {
    if (node.kind !== "assistant") continue;
    for (const block of node.blocks) {
      if (block.kind !== "tool-call" || block.callId === "") continue;
      heads.set(block.callId, {
        turn: node.turn,
        step: node.step,
        name: block.name,
        argsRaw: block.argsRaw,
      });
    }
  }

  const collectors = new Map<number, QaSourceCollector>();
  const collectorFor = (turn: number) => {
    let collector = collectors.get(turn);
    if (collector === undefined) {
      collector = new QaSourceCollector({
        sessionId,
        turn,
        registry: DEFAULT_SOURCE_EXTRACTORS,
      });
      collectors.set(turn, collector);
    }
    return collector;
  };
  for (const node of legacy.nodes) {
    if (node.kind === "assistant") collectorFor(node.turn);
  }

  let nearestTurn: number | undefined;
  let nearestStep: number | undefined;
  for (const node of legacy.nodes) {
    if (node.kind === "assistant") {
      nearestTurn = node.turn;
      nearestStep = node.step;
      continue;
    }
    if (node.kind !== "tool-result" || node.isError) continue;
    const head = heads.get(node.callId);
    // A truncated event window can retain a result after its assistant call
    // head. Keep it addressable in the synthetic turn 0 instead of dropping
    // durable evidence altogether.
    const turn = head?.turn ?? nearestTurn ?? 0;
    const name = head?.name ?? node.call?.name ?? node.callId;
    const argsRaw = head?.argsRaw ?? node.call?.argsRaw ?? "";
    collectorFor(turn).observe({
      toolName: name,
      args: argsRaw,
      result: node.content,
      presentation: node.meta,
      origin: {
        sessionId,
        turn,
        ...((head?.step ?? nearestStep) === undefined
          ? {}
          : { step: head?.step ?? nearestStep }),
        toolCallId: node.callId,
        toolName: name,
        role: "parent",
      },
      ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    });
  }
  return [...collectors.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, collector]) => collector.snapshot());
}

/** Visible evidence sources for the latest turn, shared by the drawer/footer. */
export function projectSources(
  snapshot: ConversationSnapshot | undefined,
  sessionId = "unknown",
  workspaceRoot?: string,
): readonly QaSource[] {
  return (
    projectTurnSources(snapshot, sessionId, workspaceRoot).at(-1)?.sources ?? []
  );
}
