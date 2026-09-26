import type { Volatile, VolatileSnapshot } from "@deepseek-ai/cordis";

/** A {@link Volatile} reference whose value a test can commit. */
export interface LiveNode<T> extends Volatile<T> {
  /** Fold in a new snapshot, the way the Host does before it announces it. */
  commit(next: T): void;
}

/**
 * Stand in for one live configuration node. The Host hands a plugin a stable
 * reference and replaces the value behind it, so a settable reference is the
 * whole of what a committed form edit looks like from inside the plugin.
 */
export function liveNode<T>(value: T): LiveNode<T> {
  let current = value;
  return {
    get: () => current as VolatileSnapshot<T>,
    commit: (next: T) => {
      current = next;
    },
  };
}
