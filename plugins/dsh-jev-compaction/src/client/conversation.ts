/**
 * Conversation projection of the plugin's durable session events (SPEC §28).
 *
 * One event is one card: each `jev-compaction/applied` (and each
 * `jev-compaction/skipped`) becomes its own Context keyed by the event's seq,
 * so a card keeps its identity across a reload, a fork and a replay — the
 * session log is the source of truth and nothing here recomputes a run.
 *
 * The registration has two halves, and both are required:
 *
 * - a `ConversationNodeDefinition` on `ctx.uiConversation.events`, which turns
 *   the event into a Chat view Node;
 * - a keyed renderer on the `conversation.chat.node` slot under the same kind,
 *   which draws it. The kind is contributed to the Chat package's public
 *   merge surface (`ChatNodeDataMap`), the extension point that package
 *   declares for exactly this.
 */

import type { SessionEventLike } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ChatConversationViewNode } from "@deepseek-ai/dsh-client-ui-chat/client";
import type {
  ConversationLocation,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
  JEV_COMPACTION_APPLIED_EVENT,
  JEV_COMPACTION_SKIPPED_EVENT,
  type JevCompactionAppliedEventData,
  type JevCompactionSkippedEventData,
} from "../shared/session-events.js";

/** Renderer key this plugin contributes to the Chat transcript. */
export const JEV_COMPACTION_NODE_KIND = "jev-compaction";

/** What one card renders from. */
export type JevCompactionChatData =
  | {
      readonly view: "run";
      readonly seq: number;
      readonly time: number;
      readonly run: JevCompactionAppliedEventData;
    }
  | {
      readonly view: "skip";
      readonly seq: number;
      readonly time: number;
      readonly skip: JevCompactionSkippedEventData;
    };

/**
 * Public merge surface of `@deepseek-ai/dsh-client-ui-chat/client`: declaring
 * the payload here is what makes `"jev-compaction"` a legal
 * `conversation.chat.node` key and types the node the renderer receives.
 */
declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "jev-compaction": JevCompactionChatData;
  }
}

/**
 * Read one event into card state. Returns null for every other event, which
 * is what keeps this Definition from claiming a Context that is not its own.
 */
function readCard(event: SessionEventLike): JevCompactionChatData | null {
  if (event.type === JEV_COMPACTION_APPLIED_EVENT) {
    return {
      view: "run",
      seq: event.seq,
      time: event.time,
      run: event.data as JevCompactionAppliedEventData,
    };
  }
  if (event.type === JEV_COMPACTION_SKIPPED_EVENT) {
    return {
      view: "skip",
      seq: event.seq,
      time: event.time,
      skip: event.data as JevCompactionSkippedEventData,
    };
  }
  return null;
}

/**
 * Read the state of an event the engine already accepted through `match`.
 *
 * The null branch is unreachable — `match` is the very same predicate — and it
 * is refused loudly rather than defaulted, so a divergence between the two
 * cannot quietly render an empty card.
 */
function requireCard(event: SessionEventLike): JevCompactionChatData {
  const data = readCard(event);
  if (data === null) {
    throw new Error(
      `jev-compaction: no card state for session event "${event.type}"`,
    );
  }
  return data;
}

/** Identity of the one Context an event of ours owns: its own seq. */
function matchOf(event: SessionEventLike) {
  if (readCard(event) === null) return null;
  return { id: String(event.seq), role: "start" as const };
}

/** What the node builder needs from a match: its position and its placement. */
interface AnchorLike {
  readonly event: { readonly seq: number };
  readonly location: ConversationLocation;
}

/** One final Chat node: the engine's identity plus this payload and placement. */
function chatNodeOf(
  context: ConversationNodeContext<JevCompactionChatData>,
  anchor: AnchorLike | undefined,
):
  | (ChatConversationViewNode & {
      readonly kind: typeof JEV_COMPACTION_NODE_KIND;
      readonly data: JevCompactionChatData;
    })
  | null {
  const data = context.state;
  if (data === undefined) return null;
  const location: ConversationLocation = anchor?.location ??
    context.matches[0]?.location ?? { kind: "unresolved" };
  return {
    key: context.key,
    kind: JEV_COMPACTION_NODE_KIND,
    id: context.id,
    target: "chat",
    anchorSeq: anchor?.event.seq ?? context.matches[0]?.event.seq ?? 0,
    location,
    visibility: "visible",
    data,
  };
}

/**
 * The conversation Definition: every event of ours is its own start, so the
 * card count equals the recorded run count and no two runs ever merge.
 */
export const jevCompactionConversationDefinition: ConversationNodeDefinition<JevCompactionChatData> =
  {
    kind: JEV_COMPACTION_NODE_KIND,
    target: "chat",
    match: (event) => matchOf(event),
    start: (_context, match) => requireCard(match.event),
    update: (_context, match) => requireCard(match.event),
    buildViewNode: (context) =>
      chatNodeOf(context, context.start ?? context.matches[0]),
  };
