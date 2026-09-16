import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A boolean that turns on for a fixed window and drops back off — the
 * "Скопировано" flash and its siblings. The pending timer lives in a ref and
 * is cleared by the unmount cleanup, so a pulse fired right before the block
 * leaves the DOM never schedules a state update on it, and re-pulsing restarts
 * the window instead of stacking timers.
 */
export function useTransientFlag(windowMs: number): {
  readonly on: boolean;
  readonly pulse: () => void;
} {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );
  const pulse = useCallback(() => {
    setOn(true);
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setOn(false);
    }, windowMs);
  }, [windowMs]);
  return { on, pulse };
}
