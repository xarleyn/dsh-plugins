import type { IncomingMessage } from "node:http";
import type { WebServer } from "@deepseek-ai/dsh-host-webserver";
import type { ResolvedQaSurfaceConfig } from "./types.js";
import { QA_NAVIGATION_MARKER } from "./navigation-marker.js";
import type { LaunchTokenSource } from "./launch-token.js";

/** The 0.1.x host cookie is `dsh-auth-<hash>`; presence only, never validated here. */
const DSH_AUTH_COOKIE_PATTERN = /(?:^|;\s*)dsh-auth-[^=]+=/u;

export interface QaNavigationRouteOptions {
  /**
   * Resolves the process launch token; when supplied and the browser carries
   * no host-auth cookie, the route defers the marker hand-off in favor of the
   * one-time `/?token=` exchange (relative location: the browser mints the
   * cookie on the origin it actually used).
   */
  readonly launchToken?: LaunchTokenSource;
}

/** Presence-only check: an invalid cookie still fails the root gate later. */
export function hasHostAuthCookie(request: IncomingMessage): boolean {
  const cookie = request.headers.cookie;
  return typeof cookie === "string" && DSH_AUTH_COOKIE_PATTERN.test(cookie);
}

/**
 * DSH 0.1.1 static hosting returns 404 for missing paths. Redirect a browser
 * navigation through its canonical index entry; the client restores the
 * requested pathname before activating the QA overlay.
 */
export function registerQaNavigationRoute(
  webServer: Pick<WebServer, "register">,
  config: ResolvedQaSurfaceConfig,
  options: QaNavigationRouteOptions = {},
): () => void {
  return webServer.register({
    kind: config.route.matchChildren ? "prefix" : "exact",
    path: config.route.path,
    handler: (request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD" });
        response.end();
        return;
      }
      // A browser without the host cookie cannot pass the root gate, so the
      // marker hand-off would dead-end in a 401; route it through the token
      // exchange first. GET only: the exchange itself is a GET semantics.
      if (
        request.method === "GET" &&
        config.entry.cookieBootstrap &&
        options.launchToken !== undefined &&
        !hasHostAuthCookie(request)
      ) {
        const token = options.launchToken();
        if (token !== undefined) {
          response.writeHead(302, {
            location: `/?token=${encodeURIComponent(token)}`,
            "cache-control": "no-store",
          });
          response.end();
          return;
        }
      }
      const requested = request.url ?? config.route.path;
      const location = `/?${QA_NAVIGATION_MARKER}=${encodeURIComponent(requested)}`;
      response.writeHead(302, {
        location,
        "cache-control": "no-store",
      });
      response.end();
    },
  });
}
