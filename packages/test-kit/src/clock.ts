/**
 * Deterministic clock for tests that must not depend on wall time.
 */

/**
 * A clock function with an overridable reading.
 *
 * Every call advances the reading by the configured step (the shape the
 * plugins' local `fixedClock` copies share); `set` overwrites it, which is
 * how the mutable `let now = ...; () => now` test seams jump time explicitly.
 */
export interface FixedClock {
  (): number;
  /** Overwrite the current reading; later calls keep stepping from it. */
  set(value: number): void;
}

/**
 * Create a deterministic clock.
 *
 * @param start - epoch-ms reading before the first call.
 * @param stepMs - advance per call; `0` keeps the reading constant until
 *   `set` moves it.
 */
export function fixedClock(
  start = 1_700_000_000_000,
  stepMs = 1_000,
): FixedClock {
  let value = start;
  const clock = (() => {
    value += stepMs;
    return value;
  }) as FixedClock;
  clock.set = (next) => {
    value = next;
  };
  return clock;
}
