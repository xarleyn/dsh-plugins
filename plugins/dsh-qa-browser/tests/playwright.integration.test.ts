import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { resolveQaBrowserConfig } from "../src/config.js";
import { BrowserNetworkPolicy } from "../src/host/policy.js";
import { PlaywrightBrowserProvider } from "../src/host/providers/playwright.js";
import { QaBrowserSessionManager } from "../src/host/session-manager.js";

const enabled = process.env["DSH_QA_BROWSER_E2E"] === "1";

/** The policy with a log of the destinations it was asked about. */
class RecordingPolicy extends BrowserNetworkPolicy {
  readonly asked: string[] = [];

  override async assertAllowed(rawUrl: string): Promise<URL> {
    this.asked.push(rawUrl);
    return await super.assertAllowed(rawUrl);
  }
}

/**
 * The worker a service-worker test registers. It dials one endpoint of each
 * kind the gate is supposed to cover — a fetch and a socket — from outside any
 * page, which is what makes it the case the route interception cannot serve.
 */
const WORKER_SCRIPT = `
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const port = self.location.port;
    try { await fetch(\`http://127.0.0.1:\${port}/worker-fetch\`); } catch {}
    await new Promise((resolve) => {
      const socket = new WebSocket(\`ws://127.0.0.1:\${port}/worker-feed\`);
      socket.addEventListener("open", () => socket.close());
      socket.addEventListener("error", () => socket.close());
      socket.addEventListener("close", resolve);
      setTimeout(resolve, 4000);
    });
    self.skipWaiting();
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) client.postMessage("worker-alive");
  })());
});
`;

/**
 * A loopback endpoint that records what it was asked for. It answers socket
 * upgrades with a real 101 and pushes one frame back, so an allowed socket can
 * be told apart from one that was simply never answered.
 */
async function startProbeServer(pages: Record<string, string>): Promise<{
  readonly close: () => Promise<void>;
  readonly port: number;
  readonly requests: string[];
  readonly upgrades: string[];
}> {
  const requests: string[] = [];
  const upgrades: string[] = [];
  const handedOff = new Set<import("node:stream").Duplex>();
  const server = createServer((request, response) => {
    const url = request.url ?? "";
    if (Object.hasOwn(pages, url)) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(pages[url]);
      return;
    }
    if (url === "/sw.js") {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "service-worker-allowed": "/",
      });
      response.end(WORKER_SCRIPT);
      return;
    }
    requests.push(url);
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
  });
  server.on("upgrade", (request, socket) => {
    upgrades.push(request.url ?? "");
    // An upgraded socket leaves the server's own bookkeeping, so it is tracked
    // here: a fixture that ends while a browser still holds it open would
    // otherwise wait for a closure only the page can decide.
    handedOff.add(socket);
    socket.once("close", () => handedOff.delete(socket));
    const accept = createHash("sha1")
      .update(
        `${request.headers["sec-websocket-key"] ?? ""}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
      )
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    // One unmasked text frame, which is what a server sends a page.
    const payload = Buffer.from("ready");
    socket.write(Buffer.from([0x81, payload.byteLength, ...payload]));
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    upgrades,
    close: async () => {
      for (const socket of handedOff) socket.destroy();
      handedOff.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    },
  };
}

function socketProbeConfig(
  schemes: readonly string[],
): ReturnType<typeof resolveQaBrowserConfig> {
  return resolveQaBrowserConfig({
    runtime: {
      executablePath: process.env["DSH_QA_BROWSER_EXECUTABLE"] ?? null,
    },
    security: { network: { allowedSchemes: [...schemes] } },
  });
}

describe.skipIf(!enabled)("Playwright Browser runtime", () => {
  const managers: QaBrowserSessionManager[] = [];

  afterEach(async () => {
    await Promise.allSettled(
      managers.splice(0).map((manager) => manager.dispose()),
    );
  });

  it("launches Chromium, navigates to a local fixture and returns a PNG", async () => {
    const html = await readFile(
      new URL("./fixtures/app.html", import.meta.url),
      "utf8",
    );
    let port = 0;
    const server = createServer((request, response) => {
      if (request.url === "/redirect-denied") {
        response.writeHead(302, {
          location: `http://localhost:${port}/private-target`,
        });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );

    try {
      const address = server.address() as AddressInfo;
      port = address.port;
      const config = resolveQaBrowserConfig({
        runtime: {
          executablePath: process.env["DSH_QA_BROWSER_EXECUTABLE"] ?? null,
        },
        security: { network: { denyHosts: ["localhost"] } },
      });
      const manager = new QaBrowserSessionManager({
        config,
        provider: new PlaywrightBrowserProvider(),
        policy: new BrowserNetworkPolicy(config.security.network),
        startIdleTimer: false,
      });
      managers.push(manager);

      const session = await manager.ensureSession("integration-session");
      const tabId = session.selectedTabId!;
      const result = await manager.navigate("integration-session", tabId, {
        url: `http://127.0.0.1:${address.port}/`,
      });
      manager.acquireHumanControl("integration-session", "panel-e2e");
      await expect(
        manager.history("integration-session", tabId, "reload"),
      ).rejects.toMatchObject({ code: "BROWSER_HUMAN_CONTROL_ACTIVE" });
      await manager.humanPointer("integration-session", tabId, "panel-e2e", {
        action: "click",
        x: 10,
        y: 10,
      });
      await manager.humanKey("integration-session", tabId, "panel-e2e", "Tab");
      await manager.humanText(
        "integration-session",
        tabId,
        "panel-e2e",
        "human@example.test",
      );
      await manager.humanScroll(
        "integration-session",
        tabId,
        "panel-e2e",
        0,
        80,
      );
      manager.releaseHumanControl("integration-session", "panel-e2e");
      const snapshot = await manager.snapshot("integration-session", tabId);
      const ref = (name: string) =>
        snapshot.lines.find((line) => line.name === name)?.ref;
      expect(ref("Email")).toBeTruthy();
      expect(ref("Plan")).toBeTruthy();
      expect(ref("Remember me")).toBeTruthy();
      expect(ref("Continue")).toBeTruthy();
      await manager.fillForm("integration-session", tabId, [
        { ref: ref("Email")!, value: "qa@example.test" },
        { ref: ref("Plan")!, value: "pro" },
        { ref: ref("Remember me")!, value: true },
      ]);
      const afterFill = await manager.snapshot("integration-session", tabId);
      const continueRef = afterFill.lines.find(
        (line) => line.name === "Continue",
      )?.ref;
      await manager.click("integration-session", tabId, continueRef!);
      const completed = await manager.snapshot("integration-session", tabId, {
        mode: "document",
      });
      const image = await manager.screenshot("integration-session", tabId);

      expect(result).toMatchObject({
        ok: true,
        title: "QA Browser fixture",
      });
      expect(completed.text).toContain("Done: qa@example.test / pro / true");
      expect(image.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      await expect(
        manager.navigate("integration-session", tabId, {
          url: `http://127.0.0.1:${address.port}/redirect-denied`,
        }),
      ).rejects.toMatchObject({ code: "BROWSER_HOST_BLOCKED" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    }
  });

  it("asks the policy about a WebSocket and denies the handshake it refused", async () => {
    const html = await readFile(
      new URL("./fixtures/ws-probe.html", import.meta.url),
      "utf8",
    );
    const probe = await startProbeServer({ "/probe": html });
    try {
      const config = socketProbeConfig(["http", "https"]);
      const policy = new RecordingPolicy(config.security.network);
      const manager = new QaBrowserSessionManager({
        config,
        provider: new PlaywrightBrowserProvider(),
        policy,
        startIdleTimer: false,
      });
      managers.push(manager);
      const session = await manager.ensureSession("ws-denied");
      const tabId = session.selectedTabId!;
      await manager.navigate("ws-denied", tabId, {
        url: `http://127.0.0.1:${probe.port}/probe`,
      });
      await manager.wait("ws-denied", tabId, {
        text: "closed",
        timeoutMs: 15_000,
      });

      // The gate saw the socket — that is the whole finding — and the refusal
      // it answered means the destination was never offered a handshake.
      expect(policy.asked).toContain(`ws://127.0.0.1:${probe.port}/feed`);
      expect(probe.upgrades).toEqual([]);
    } finally {
      await probe.close();
    }
  });

  it("carries a WebSocket the policy allows through to its server", async () => {
    const html = await readFile(
      new URL("./fixtures/ws-probe.html", import.meta.url),
      "utf8",
    );
    const probe = await startProbeServer({ "/probe": html });
    try {
      const config = socketProbeConfig(["http", "https", "ws"]);
      const manager = new QaBrowserSessionManager({
        config,
        provider: new PlaywrightBrowserProvider(),
        policy: new BrowserNetworkPolicy(config.security.network),
        startIdleTimer: false,
      });
      managers.push(manager);
      const session = await manager.ensureSession("ws-allowed");
      const tabId = session.selectedTabId!;
      await manager.navigate("ws-allowed", tabId, {
        url: `http://127.0.0.1:${probe.port}/probe`,
      });
      // A socket the policy let through still carries its traffic: the frame the
      // fixture pushes after the handshake reaches the page.
      await manager.wait("ws-allowed", tabId, {
        text: "message:ready",
        timeoutMs: 15_000,
      });

      expect(probe.upgrades).toEqual(["/feed"]);
    } finally {
      await probe.close();
    }
  });

  it("keeps a service worker from dialing past the gate", async () => {
    const html = await readFile(
      new URL("./fixtures/sw-probe.html", import.meta.url),
      "utf8",
    );
    const probe = await startProbeServer({ "/sw-probe": html });
    try {
      // Every scheme is open, so what is being tested is the gate's reach
      // rather than the answer it would give: a worker dials from outside it.
      const config = socketProbeConfig(["http", "https", "ws"]);
      const policy = new RecordingPolicy(config.security.network);
      const manager = new QaBrowserSessionManager({
        config,
        provider: new PlaywrightBrowserProvider(),
        policy,
        startIdleTimer: false,
      });
      managers.push(manager);
      const session = await manager.ensureSession("sw-probe");
      const tabId = session.selectedTabId!;
      await manager.navigate("sw-probe", tabId, {
        url: `http://127.0.0.1:${probe.port}/sw-probe`,
      });
      // The page's own report of the worker: silence means nothing was created
      // to speak, which is the point of the context option under test.
      await manager.wait("sw-probe", tabId, {
        text: "no-worker",
        timeoutMs: 15_000,
      });

      // Playwright routes pages, and a worker is not a page: its fetch and its
      // socket would reach this server unasked and unattributed. The context
      // therefore never lets one be created.
      expect(policy.asked.filter((url) => url.includes("/worker-"))).toEqual(
        [],
      );
      expect(probe.requests).toEqual([]);
      expect(probe.upgrades).toEqual([]);
    } finally {
      await probe.close();
    }
  });
});
