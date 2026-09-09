/**
 * Resolve with the first snapshot of an observable source that satisfies
 * `predicate`, or reject after `timeoutMs`. This is the DSH-runtime glue the
 * QA surface needs instead of ad-hoc sleeps; the source only has to expose
 * the getSnapshot/subscribe store pair used across the client bundle.
 */
export function waitFor<T>(
  source: {
    getSnapshot(): T;
    subscribe(listener: () => void): () => void;
  },
  predicate: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const current = source.getSnapshot();
  if (predicate(current)) return Promise.resolve(current);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout: { id?: ReturnType<typeof setTimeout> } = {};
    let unsubscribe: () => void = () => undefined;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      if (timeout.id !== undefined) clearTimeout(timeout.id);
      unsubscribe();
      resolve(value);
    };
    unsubscribe = source.subscribe(() => {
      const next = source.getSnapshot();
      if (predicate(next)) finish(next);
    });
    // Tolerate observable implementations that notify synchronously while a
    // subscriber is being installed, and close that subscription afterward.
    if (settled) {
      unsubscribe();
      return;
    }
    const afterSubscribe = source.getSnapshot();
    if (predicate(afterSubscribe)) {
      finish(afterSubscribe);
      return;
    }
    timeout.id = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error("Timed out waiting for the DSH runtime."));
    }, timeoutMs);
  });
}
