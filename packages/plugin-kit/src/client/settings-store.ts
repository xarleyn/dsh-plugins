/**
 * React calls external-store callbacks as plain functions, while
 * SettingsScope's methods depend on their receiver. Forwarding the methods
 * directly loses `this` and crashes while reading the internal store, so
 * bind them through stable wrappers.
 */
export function bindSettingsExternalStore<TSnapshot>(scope: {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TSnapshot;
}): {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TSnapshot;
} {
  return {
    subscribe: (listener) => scope.subscribe(listener),
    getSnapshot: () => scope.getSnapshot(),
  };
}
