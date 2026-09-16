import { useEffect, useState } from "react";

/** Re-render cadence; phrases and durations only move on an interval edge. */
const NOW_TICK_MS = 1_000;

/**
 * A per-second `Date.now()` that runs only while `active` (and re-syncs the
 * instant it turns on). The thinking phrase and the running work group read
 * the same clock through this hook, so the surface never stacks duplicate
 * second intervals for one turn.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
