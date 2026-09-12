import { useMemo } from "react";
import type { QaMessage } from "../types.js";
import {
  buildTurnRailItems,
  type QaTurnRailItem,
} from "./components/QaTurnRail.js";
import {
  collectVariantGroups,
  type QaVariantGroup,
} from "./components/VariantSwitcher.js";

export interface QaTranscriptView {
  readonly visibleMessages: readonly QaMessage[];
  /** Answer groups by the user message id that opens them. */
  readonly groupByPromptId: ReadonlyMap<string, QaVariantGroup>;
  /** Per group: the turn the current variant offset selects. */
  readonly selectedTurn: ReadonlyMap<string, number>;
  readonly railItems: readonly QaTurnRailItem[];
}

/**
 * Memoized transcript view model. The controller republishes state with a
 * fresh messages array on every stream frame, but re-renders that keep the
 * transcript unchanged (drawers, the active turn mark, variant offsets) must
 * not re-run the projections — and per-row group lookups go through a map
 * instead of a linear find inside the render loop.
 */
export function useTranscriptView(
  messages: readonly QaMessage[],
  variantOffsets: Record<string, number>,
): QaTranscriptView {
  return useMemo(() => {
    const groups = collectVariantGroups(messages);
    const groupByPromptId = new Map<string, QaVariantGroup>();
    const turnToGroup = new Map<number, string>();
    const selectedTurn = new Map<string, number>();
    for (const group of groups) {
      groupByPromptId.set(group.groupId, group);
      const offset = variantOffsets[group.groupId] ?? 0;
      const turn =
        group.turns[Math.max(0, group.turns.length - 1 - offset)] ??
        group.turns.at(-1);
      if (turn !== undefined) {
        selectedTurn.set(group.groupId, turn);
        for (const groupTurn of group.turns)
          turnToGroup.set(groupTurn, group.groupId);
      }
    }
    const visibleMessages = messages.filter((message) => {
      if (
        (message.role === "assistant" || message.role === "work") &&
        message.turn !== undefined
      ) {
        const groupId = turnToGroup.get(message.turn);
        return (
          groupId === undefined || selectedTurn.get(groupId) === message.turn
        );
      }
      return true;
    });
    return {
      visibleMessages,
      groupByPromptId,
      selectedTurn,
      railItems: buildTurnRailItems(visibleMessages),
    };
  }, [messages, variantOffsets]);
}
