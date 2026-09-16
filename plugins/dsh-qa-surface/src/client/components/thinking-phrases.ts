import {
  DEFAULT_THINKING_PHRASES,
  thinkingPhrase,
} from "../../thinking-phrases.js";
import { useNow } from "./use-now.js";

export { DEFAULT_THINKING_PHRASES, thinkingPhrase };

/**
 * Phrase for a turn that started at `startedAt`. Every reader that passes the
 * same start time and phrase list lands on the same phrase, so the composer
 * hint and the work list never disagree.
 */
export function useThinkingPhrase(
  running: boolean,
  startedAt: number | undefined,
  phrases: readonly string[] = DEFAULT_THINKING_PHRASES,
): string | null {
  const now = useNow(running);
  if (!running) return null;
  return thinkingPhrase(now - (startedAt ?? now), phrases);
}
