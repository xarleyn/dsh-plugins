/**
 * A Cordis-context stand-in for the interactive seams: it keeps the listeners
 * a gate registers and hands them back, so a test can invoke the gate exactly
 * where the harness would.
 */
export function fakeContext() {
  const listeners = new Map<string, ((...args: never[]) => unknown)[]>();
  return {
    context: {
      on: (
        name: string,
        listener: (...args: never[]) => unknown,
        _options?: unknown,
      ) => {
        listeners.set(name, [...(listeners.get(name) ?? []), listener]);
        return () => {
          listeners.set(
            name,
            (listeners.get(name) ?? []).filter((item) => item !== listener),
          );
        };
      },
    } as never,
    /** The first listener of one event: the gate's own entry point. */
    handler(name: string): (...args: unknown[]) => unknown {
      const listener = listeners.get(name)?.[0];
      if (listener === undefined) throw new Error(`no listener for ${name}`);
      return listener as (...args: unknown[]) => unknown;
    },
    count(name: string): number {
      return (listeners.get(name) ?? []).length;
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
