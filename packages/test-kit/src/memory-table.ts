/**
 * In-memory stand-in for the storage tables plugins read and write.
 */

/**
 * A KV table good enough for registries and providers: synchronous reads,
 * promise-valued writes, and an `update` that rejects on a missing key.
 */
export interface MemoryTable<T> {
  get(key: string): T | undefined;
  entries(): IterableIterator<[string, T]>;
  keys(): IterableIterator<string>;
  readonly size: number;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  update(key: string, fn: (current: T) => T): Promise<T>;
}

/** Create an empty or seeded in-memory table. */
export function memoryTable<T>(
  seed: Iterable<readonly [string, T]> = [],
): MemoryTable<T> {
  const store = new Map<string, T>(seed);
  return {
    get: (key) => store.get(key),
    entries: () => store.entries(),
    keys: () => store.keys(),
    get size() {
      return store.size;
    },
    put: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => Promise.resolve(store.delete(key)),
    update: (key, fn) => {
      const current = store.get(key);
      if (current === undefined) {
        return Promise.reject(new Error("missing-key"));
      }
      const next = fn(current);
      store.set(key, next);
      return Promise.resolve(next);
    },
  };
}
