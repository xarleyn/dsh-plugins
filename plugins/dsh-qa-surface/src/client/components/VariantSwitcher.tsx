import type { QaMessage } from "../../types.js";

export interface QaVariantGroup {
  /** The user message that anchors the group. */
  readonly groupId: string;
  /** Answer turns triggered by that message, in order. */
  readonly turns: readonly number[];
}

/**
 * Group answer turns under the user message that triggered them. The session
 * has no truncation seam, so a regenerated answer is a real follow-up turn;
 * consecutive turns after one user message read as its variants.
 */
export function collectVariantGroups(
  messages: readonly QaMessage[],
): readonly QaVariantGroup[] {
  const groups: { groupId: string; turns: number[] }[] = [];
  let current: { groupId: string; turns: number[] } | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      current = { groupId: message.id, turns: [] };
      groups.push(current);
      continue;
    }
    if (
      current === undefined ||
      (message.role !== "assistant" && message.role !== "work")
    ) {
      continue;
    }
    if (message.turn !== undefined && !current.turns.includes(message.turn)) {
      current.turns.push(message.turn);
    }
  }
  return groups;
}

export function VariantSwitcher({
  count,
  offset,
  onStep,
}: {
  readonly count: number;
  readonly offset: number;
  readonly onStep: (offset: number) => void;
}) {
  return (
    <div className="dsh-qa-variants" aria-label="Варианты ответа">
      <button
        type="button"
        aria-label="Предыдущий вариант"
        disabled={offset >= count - 1}
        onClick={() => onStep(offset + 1)}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="m8.75 3.5-3.5 3.5 3.5 3.5" />
        </svg>
      </button>
      <span>
        {count - offset}/{count}
      </span>
      <button
        type="button"
        aria-label="Следующий вариант"
        disabled={offset <= 0}
        onClick={() => onStep(offset - 1)}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="m5.25 3.5 3.5 3.5-3.5 3.5" />
        </svg>
      </button>
    </div>
  );
}
