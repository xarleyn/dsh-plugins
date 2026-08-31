/**
 * React invokes external-store callbacks as plain functions. SettingsScope's
 * methods depend on their receiver, so forward calls through stable wrappers.
 */
export function bindSettingsExternalStore<TSnapshot>(scope: {
  subscribe(listener: () => void): () => void
  getSnapshot(): TSnapshot
}): {
  subscribe(listener: () => void): () => void
  getSnapshot(): TSnapshot
} {
  return {
    subscribe: listener => scope.subscribe(listener),
    getSnapshot: () => scope.getSnapshot(),
  }
}
