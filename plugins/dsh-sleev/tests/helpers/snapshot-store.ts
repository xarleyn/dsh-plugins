/**
 * Stand-in for the Host snapshot-store package.
 *
 * The card's controller builds its store on `@deepseek-ai/dsh-client-store`, which
 * the browser bundle carries and this Node suite does not resolve, so every client
 * test installs this module mock. One copy serves all three suites: the render tests
 * never construct a store, they only need the import to load.
 */
export function createSnapshotStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: T) => {
      value = next;
      for (const listener of listeners) listener();
    },
    update: () => {},
  };
}
