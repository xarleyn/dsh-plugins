import { createServer, type RequestListener } from "node:http";
import type { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { qaPwaAppPath, registerQaPwaRoute } from "../../src/pwa.js";

it("uses the active presentation's QA path and ignores a disabled surface", () => {
  const config = resolveConfig({ route: { path: "/demo/chat" } });
  expect(qaPwaAppPath(config, {})).toBe("/demo/chat");
  expect(qaPwaAppPath(config, { DSH_UI_MODE: "qa" })).toBe("/qa");
  expect(
    qaPwaAppPath(config, { DSH_UI_MODE: "qa", DSH_QA_BASE_PATH: "/desk" }),
  ).toBe("/desk");
  expect(qaPwaAppPath(resolveConfig({ enabled: false }), {})).toBeUndefined();
  expect(
    qaPwaAppPath(config, {
      DSH_UI_MODE: "qa",
      DSH_QA_BASE_PATH: "//other.example",
    }),
  ).toBeUndefined();
});

it("serves only the declared PWA assets with a stable, QA-scoped identity", async () => {
  let listener: RequestListener | undefined;
  const webServer = {
    register(route) {
      expect(route).toMatchObject({ kind: "prefix", path: "/demo/chat/_pwa" });
      if (!("handler" in route)) throw new Error("Missing PWA handler");
      listener = route.handler;
      return () => {
        listener = undefined;
      };
    },
  } satisfies Pick<WebServer, "register">;
  let title = "Демо-продукт";
  const unregister = registerQaPwaRoute(webServer, "/demo/chat", () => title);
  const server = createServer(listener);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing port");
    const base = `http://127.0.0.1:${address.port}/demo/chat/_pwa/`;
    const manifest = await fetch(`${base}manifest.webmanifest`);
    expect(manifest.headers.get("content-type")).toContain(
      "application/manifest+json",
    );
    expect(manifest.headers.get("cache-control")).toBe("no-cache");
    expect(await manifest.json()).toMatchObject({
      id: "/demo/chat",
      name: title,
      start_url: "/demo/chat",
      scope: "/demo/chat",
      display: "standalone",
      icons: [
        { src: "icon-192.png", sizes: "192x192" },
        { src: "icon-512.png", sizes: "512x512", purpose: "any maskable" },
      ],
    });
    title = "Демо-продукт 2";
    expect(
      await (await fetch(`${base}manifest.webmanifest`)).json(),
    ).toMatchObject({
      id: "/demo/chat",
      name: title,
    });
    const worker = await fetch(`${base}service-worker.js`, { method: "HEAD" });
    expect(worker.headers.get("content-type")).toContain("text/javascript");
    expect(worker.headers.get("service-worker-allowed")).toBe("/demo/chat");
    expect(await worker.text()).toBe("");
    const icon = await fetch(`${base}apple-touch-icon.png`);
    expect(icon.headers.get("content-type")).toBe("image/png");
    expect((await icon.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect((await fetch(`${base}../_pwa/%2e%2fpackage.json`)).status).toBe(404);
    expect(
      (await fetch(`${base}bootstrap.js`, { method: "POST" })).status,
    ).toBe(405);
  } finally {
    unregister();
    await new Promise<void>((done) => server.close(() => done()));
  }
  expect(listener).toBeUndefined();
});
