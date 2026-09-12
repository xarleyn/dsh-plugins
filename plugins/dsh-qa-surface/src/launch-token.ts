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
 * Resolve the launch token once per process (it is stable for the process
 * lifetime); a missing connection service or an unusable answer warns once
 * and permanently disables the bridge instead of retrying per request.
 */
export function makeLaunchTokenSource(
  getConnection: () => AuthenticatedUrlFace | undefined,
  warn: (message: string) => void,
): LaunchTokenSource {
  let cached: string | undefined | null = null;
  let warned = false;
  const warnOnce = (message: string): void => {
    if (warned) return;
    warned = true;
    warn(message);
  };
  return () => {
    if (cached !== null) return cached;
    try {
      const connection = getConnection();
      if (
        connection === undefined ||
        typeof connection.authenticatedUrl !== "function"
      ) {
        warnOnce(
          "launch-token bridge inactive: no connection.authenticatedUrl on the host",
        );
        cached = undefined;
        return cached;
      }
      // The loopback base only feeds the URL parsing; host/scheme are dropped.
      const token = new URL(
        connection.authenticatedUrl("http://127.0.0.1"),
      ).searchParams.get("token");
      if (token === null || token === "") {
        warnOnce(
          "launch-token bridge inactive: authenticatedUrl carries no token",
        );
        cached = undefined;
        return cached;
      }
      cached = token;
    } catch (error) {
      warnOnce(
        `launch-token bridge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      cached = undefined;
    }
    return cached;
  };
}
