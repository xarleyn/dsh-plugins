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
    getSnapshot(): { readonly current?: unknown };
  };
}

/** The session the user is looking at, or `''` when none can be read. */
export function currentSessionId(ctx: unknown): string {
  const sessions = (ctx as { readonly sessions?: SessionsFace }).sessions;
  if (sessions === undefined) return "";
  try {
    const current = sessions.list.getSnapshot().current;
    return typeof current === "string" ? current : "";
  } catch {
    // A service that is present but not yet bound must not break the page.
    return "";
  }
}
