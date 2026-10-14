import type { WebServer } from "@deepseek-ai/dsh-host-webserver";
import type { ResolvedQaSurfaceConfig } from "../types.js";
import type { QaOidcService } from "./service.js";

export function registerQaOidcRoute(
  webServer: Pick<WebServer, "register">,
  config: ResolvedQaSurfaceConfig,
  service: QaOidcService,
): () => void {
  return webServer.register({
    kind: "exact",
    path: new URL(config.accounts.oidc.redirectUri).pathname,
    handler: async (request, response) => {
      const headers = {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      };
      if (request.method !== "GET") {
        response.writeHead(405, { ...headers, allow: "GET" });
        response.end();
        return;
      }
      try {
        const location = await service.callback(request.url ?? "");
        response.writeHead(302, { ...headers, location });
        response.end();
      } catch {
        response.writeHead(400, {
          ...headers,
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("Corporate sign-in failed. Return to QA and retry.");
      }
    },
  });
}
