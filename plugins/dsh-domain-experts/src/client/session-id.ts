/**
 * The client sessions service, read through a local structural face.
 *
 * The host half of this package legitimately augments `Context.sessions` with
 * the server-side session store, and both halves share one typecheck program.
 * Importing the browser face as well would leave the two declarations merged
 * into a single unusable property type, so the client reads the two fields it
 * needs structurally instead of widening the dependency.
 */
interface SessionsFace {
  readonly list: {
    getSnapshot(): {
      readonly current?: unknown;
      readonly byId?: Readonly<
        Record<
          string,
          {
            readonly retainedBy?: Readonly<Record<string, number>>;
          }
        >
      >;
    };
  };
}

/** The session the user is looking at, or `''` when none can be read. */
export function currentSessionId(ctx: unknown): string {
  const sessions = (ctx as { readonly sessions?: SessionsFace }).sessions;
  if (sessions === undefined) return "";
  try {
    const snapshot = sessions.list.getSnapshot();
    if (typeof snapshot.current === "string" && snapshot.current !== "") {
      return snapshot.current;
    }
    // Host 0.2 owns navigation in the main view, independently of the Session
    // catalog. Its retainedBy projection identifies that view's held Session
    // even while the Plugins panel is open. Never borrow an arbitrary running
    // chat (or a gateway/preview reference) as the test's parent.
    const selected = Object.entries(snapshot.byId ?? {}).filter(
      ([, row]) => (row.retainedBy?.mainView ?? 0) > 0,
    );
    return selected.length === 1 ? selected[0]![0] : "";
  } catch {
    // A service that is present but not yet bound must not break the page.
    return "";
  }
}
