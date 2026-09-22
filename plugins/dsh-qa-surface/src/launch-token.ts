/**
 * Plugin-side launch-token bridge (the pattern proven by dsh-auth-gate): the
 * 0.1.x host exposes `connection.authenticatedUrl(baseUrl)` whose `?token=`
 * parameter carries the per-process launch token. The `/qa` route handler
 * uses it to send cookie-less browsers through the one-time host-cookie
 * exchange themselves, so the transparent entry works without the qa-deploy
 * proxy. The host/scheme of the resolved URL are dropped — the redirect is
 * relative, so the browser stays on the origin it actually used.
 */
export type LaunchTokenSource = () => string | undefined;

interface AuthenticatedUrlFace {
  authenticatedUrl?(baseUrl: string): string;
}

/**
 * Resolve the launch token lazily, on the navigations that need it.
 *
 * A token that resolved is cached — it is stable for the process lifetime, so
 * the host is asked once. A failure is **not** cached: the first `/qa` request
 * can arrive while the plugin tree is still starting, when `connection` is not
 * answerable yet, and treating that single early answer as final used to leave
 * every later cookie-less browser on the marker hand-off, which dead-ends at
 * the host's token screen until the next restart. The failure is reported once
 * per reason and retried quietly afterwards, so the retry costs a service
 * lookup and never a log flood.
 */
export function makeLaunchTokenSource(
  getConnection: () => AuthenticatedUrlFace | undefined,
  warn: (message: string) => void,
): LaunchTokenSource {
  let cached: string | undefined;
  const warned = new Set<string>();
  const warnOnce = (reason: string, message: string): void => {
    if (warned.has(reason)) return;
    warned.add(reason);
    warn(message);
  };
  return () => {
    if (cached !== undefined) return cached;
    try {
      const connection = getConnection();
      if (
        connection === undefined ||
        typeof connection.authenticatedUrl !== "function"
      ) {
        warnOnce(
          "no-bridge",
          "launch-token bridge inactive: no connection.authenticatedUrl on the host",
        );
        return undefined;
      }
      // The loopback base only feeds the URL parsing; host/scheme are dropped.
      const token = new URL(
        connection.authenticatedUrl("http://127.0.0.1"),
      ).searchParams.get("token");
      if (token === null || token === "") {
        warnOnce(
          "no-token",
          "launch-token bridge inactive: authenticatedUrl carries no token",
        );
        return undefined;
      }
      cached = token;
    } catch (error) {
      warnOnce(
        "failed",
        `launch-token bridge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
    return cached;
  };
}
