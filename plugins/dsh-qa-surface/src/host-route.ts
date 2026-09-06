import type { WebServer } from "@deepseek-ai/dsh-host-webserver";
import type { ResolvedQaSurfaceConfig } from "./types.js";
import { QA_NAVIGATION_MARKER } from "./navigation-marker.js";

/**
 * DSH 0.1.1 static hosting returns 404 for missing paths. Redirect a browser
 * navigation through its canonical index entry; the client restores the
 * requested pathname before activating the QA overlay.
 */
export function registerQaNavigationRoute(
  webServer: Pick<WebServer, "register">,
  config: ResolvedQaSurfaceConfig,
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
