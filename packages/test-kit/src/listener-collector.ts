/**
 * Collector for the listeners a fake host context registers.
 */

/**
 * Keeps the subscriptions a plugin registers on a fake context and hands them
 * back, so a test can invoke the handler exactly where the host would.
 * `on` mirrors the Cordis `ctx.on(event, listener, options)` shape.
 */
export interface ListenerCollector {
  /** Register a listener under an event name; returns the unsubscribe. */
  on(
    name: string,
    listener: (...args: never[]) => unknown,
    options?: unknown,
  ): () => void;
  /** The first listener of one event: the plugin's own entry point. */
  handler(name: string): (...args: unknown[]) => unknown;
  /** How many listeners are registered for one event. */
  count(name: string): number;
}

/** Create an empty collector. */
export function listenerCollector(): ListenerCollector {
  const listeners = new Map<string, ((...args: never[]) => unknown)[]>();
  return {
    on: (name, listener) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
      return () => {
        listeners.set(
          name,
          (listeners.get(name) ?? []).filter((item) => item !== listener),
        );
      };
    },
    handler(name) {
      const listener = listeners.get(name)?.[0];
      if (listener === undefined) throw new Error(`no listener for ${name}`);
      return listener as (...args: unknown[]) => unknown;
    },
    count: (name) => (listeners.get(name) ?? []).length,
  };
}
