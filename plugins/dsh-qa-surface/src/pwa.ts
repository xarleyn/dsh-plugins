import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import type {
  IndexInjection,
  WebServer,
} from "@deepseek-ai/dsh-host-webserver";
import type { ResolvedQaSurfaceConfig } from "./types.js";
import { qaKioskDeployment } from "./ui-mode.js";

const ASSET_DIRECTORY = "_pwa";
const THEME_COLOR = "#182437";
const icons = [
  { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  {
    src: "icon-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any maskable",
  },
];

const assets = new Map([
  ["bootstrap.js", "text/javascript; charset=utf-8"],
  ["service-worker.js", "text/javascript; charset=utf-8"],
  ...icons.map(({ src, type }): [string, string] => [src, type]),
  ["apple-touch-icon.png", "image/png"],
]);

export function qaPwaAppPath(
  config: ResolvedQaSurfaceConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  if (!config.enabled) return undefined;
  const kioskPath = env.DSH_QA_BASE_PATH?.trim();
  const path = qaKioskDeployment(env)
    ? kioskPath?.startsWith("/") && !kioskPath.endsWith("/")
      ? kioskPath
      : "/qa"
    : config.route.path;
  // A path used as a manifest identity or script URL must round-trip as a
  // same-origin pathname, with no query, fragment, or scheme-relative form.
  const base = "https://qa.example";
  const url = URL.parse(path, base);
  return url?.origin === base &&
    url.href === base + path &&
    path === url.pathname
    ? path
    : undefined;
}

export function qaPwaBootstrapRow(path: string): IndexInjection {
  return {
    kind: "script-src",
    placement: "head",
    src: `${path}/${ASSET_DIRECTORY}/bootstrap.js`,
  };
}

function manifest(appPath: string, name: string): string {
  return JSON.stringify({
    id: appPath,
    name,
    short_name: name,
    lang: "ru",
    start_url: appPath,
    scope: appPath,
    display: "standalone",
    theme_color: THEME_COLOR,
    background_color: THEME_COLOR,
    icons,
  });
}

function end(
  response: ServerResponse,
  method: string,
  type: string,
  body: Buffer | string,
): void {
  response.writeHead(200, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  response.end(method === "HEAD" ? undefined : body);
}

export function registerQaPwaRoute(
  webServer: Pick<WebServer, "register">,
  appPath: string,
  appName: () => string,
): () => void {
  const path = `${appPath}/${ASSET_DIRECTORY}`;
  return webServer.register({
    kind: "prefix",
    path,
    async handler(request, response) {
      const method = request.method ?? "";
      if (method !== "GET" && method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      const pathname = request.url?.split("?", 1)[0];
      const file = pathname?.startsWith(`${path}/`)
        ? pathname.slice(path.length + 1)
        : "";
      if (file === "manifest.webmanifest") {
        end(
          response,
          method,
          "application/manifest+json; charset=utf-8",
          manifest(appPath, appName()),
        );
        return;
      }
      const type = assets.get(file);
      if (type === undefined) {
        response.writeHead(404).end();
        return;
      }
      const bytes = await readFile(new URL(`../pwa/${file}`, import.meta.url));
      if (file === "service-worker.js") {
        response.setHeader("service-worker-allowed", appPath);
      }
      end(response, method, type, bytes);
    },
  });
}
