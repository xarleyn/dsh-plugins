/**
 * A Cordis-context stand-in for the interactive seams: it keeps the listeners
 * a gate registers and hands them back, so a test can invoke the gate exactly
 * where the harness would. Registration order is the dispatch order, and a
 * listener registered with `prepend` is queued ahead of the ones already
 * there — the harness waterfall chooses a claimer the same way.
 */
export function fakeContext() {
  const listeners = new Map<string, ((...args: never[]) => unknown)[]>();
  const prepended = new Set<string>();
  const on = (
    name: string,
    listener: (...args: never[]) => unknown,
    options?: { readonly prepend?: boolean },
  ): (() => void) => {
    const current = listeners.get(name) ?? [];
    listeners.set(
      name,
      options?.prepend === true
        ? [listener, ...current]
        : [...current, listener],
    );
    if (options?.prepend === true) prepended.add(name);
    return () => {
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((item) => item !== listener),
      );
    };
  };
  return {
    context: { on } as never,
    /** Register a competing listener the way another plugin would. */
    register(
      name: string,
      listener: (...args: never[]) => unknown,
    ): () => void {
      return on(name, listener);
    },
    /** The first listener of one event: the gate's own entry point. */
    handler(name: string): (...args: unknown[]) => unknown {
      const listener = listeners.get(name)?.[0];
      if (listener === undefined) throw new Error(`no listener for ${name}`);
      return listener as (...args: unknown[]) => unknown;
    },
    /**
     * Every listener of one event, in dispatch order.
     */
    order(name: string): readonly ((...args: never[]) => unknown)[] {
      return [...(listeners.get(name) ?? [])];
    },
    /** Whether any listener of that event asked to be queued first. */
    prepended(name: string): boolean {
      return prepended.has(name);
    },
    count(name: string): number {
      return (listeners.get(name) ?? []).length;
    },
    /**
     * Run one event the way the harness waterfall does: every listener gets
     * the rest of the chain as `next`, so claiming and delegating can be told
     * apart from the outside.
     */
    async dispatch(
      name: string,
      request: unknown,
      terminal: () => Promise<unknown>,
    ): Promise<unknown> {
      const chain = listeners.get(name) ?? [];
      let index = -1;
      const next = async (): Promise<unknown> => {
        index += 1;
        const listener = chain[index];
        if (listener === undefined) return terminal();
        return (listener as (request: unknown, next: () => unknown) => unknown)(
          request,
          next,
        );
      };
      return next();
    },
  };
}

/** One fake agent around a session header, the shape both seams read. */
export function sessionAgent(
  sessionId: string,
  parentSession?: string,
): { readonly session: { id: string; header: Record<string, unknown> } } {
  return {
    session: { id: sessionId, header: { id: sessionId, parentSession } },
  };
}
