import { useEffect, useState } from "react";
import {
  DEFAULT_THINKING_PHRASES,
  thinkingPhrase,
} from "../../thinking-phrases.js";

export { DEFAULT_THINKING_PHRASES, thinkingPhrase };

/** Re-render cadence; a phrase only changes on an interval edge. */
const CLOCK_TICK_MS = 1_000;

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
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [running]);

  if (!running) return null;
  return thinkingPhrase(now - (startedAt ?? now), phrases);
}
