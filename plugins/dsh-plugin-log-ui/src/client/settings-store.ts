/**
 * React calls external-store callbacks as plain functions. SettingsScope's
 * methods use their receiver, so forwarding them directly loses `this` and
 * crashes while reading the internal store.
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
