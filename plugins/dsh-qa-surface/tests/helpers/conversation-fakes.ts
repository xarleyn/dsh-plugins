import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  ChatSnapshot,
  LegacyConversationSlice,
} from "@deepseek-ai/dsh-client-ui-chat/client";

export function legacy(
  overrides: Partial<LegacyConversationSlice> = {},
): LegacyConversationSlice {
  return {
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    ...overrides,
  };
}

export function snapshot(
  slice: LegacyConversationSlice = legacy(),
): ConversationSnapshot {
  const chat = { legacy: slice } as unknown as ChatSnapshot;
  return {
    views: { get: (target) => (target === "chat" ? chat : undefined) },
    activeTargets: new Set(["chat"]),
  };
}
