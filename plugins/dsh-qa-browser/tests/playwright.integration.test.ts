import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { resolveQaBrowserConfig } from "../src/config.js";
import { BrowserNetworkPolicy } from "../src/host/policy.js";
import { PlaywrightBrowserProvider } from "../src/host/providers/playwright.js";
import { QaBrowserSessionManager } from "../src/host/session-manager.js";

import {
  devToolsHostProbe,
  discoverChromium,
  freePort,
  removeProfileDir,
  startExternalChromium,
  stopExternalChromium,
  waitForExit,
  withAttachedChromium,
} from "./external-chromium.helpers.js";

const enabled = process.env["DSH_QA_BROWSER_E2E"] === "1";

/** The `Origin` a web page puts on a socket it opens from itself. */
const PAGE_ORIGIN = "http://page.example";

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
  cdpEndpoint: string | null,
): ReturnType<typeof resolveQaBrowserConfig> {
  return resolveQaBrowserConfig({
    runtime:
      cdpEndpoint === null
        ? {
            executablePath: process.env["DSH_QA_BROWSER_EXECUTABLE"] ?? null,
          }
        : { mode: "attach", cdpEndpoint },
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

  it("drives an external Chromium over CDP and leaves it running on stop", async () => {
    // The whole suite is asked for by `DSH_QA_BROWSER_E2E`, so a run that wants
    // a browser to join and finds none fails in this search instead of
    // skipping: a skipped attach case is the one result this card's claim
    // cannot be read from.
    const executable = discoverChromium();
    const html = await readFile(
      new URL("./fixtures/app.html", import.meta.url),
      "utf8",
    );
    let fixturePort = 0;
    const server = createServer((request, response) => {
      if (request.url === "/redirect-denied") {
        response.writeHead(302, {
          location: `http://localhost:${String(fixturePort)}/private-target`,
        });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    fixturePort = (server.address() as AddressInfo).port;
    const debugPort = await freePort();
    const external = await startExternalChromium(executable, debugPort);

    try {
      // A page the deployment owns, opened in the browser's own context
      // before this runtime ever dials in. Attach mode promises the person
      // keeps it, so the test has to be able to lose it.
      const personUrl = `http://127.0.0.1:${String(fixturePort)}/person-tab`;
      const opened = await fetch(
        `http://127.0.0.1:${String(debugPort)}/json/new?${encodeURIComponent(personUrl)}`,
        { method: "PUT" },
      );
      expect(opened.ok).toBe(true);

      const config = resolveQaBrowserConfig({
        runtime: {
          mode: "attach",
          cdpEndpoint: `http://127.0.0.1:${String(debugPort)}`,
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

      const session = await manager.ensureSession("attach-session");
      const tabId = session.selectedTabId!;
      const result = await manager.navigate("attach-session", tabId, {
        url: `http://127.0.0.1:${String(fixturePort)}/`,
      });
      const snapshot = await manager.snapshot("attach-session", tabId);
      const image = await manager.screenshot("attach-session", tabId);

      expect(result).toMatchObject({
        ok: true,
        title: "QA Browser fixture",
      });
      expect(snapshot.lines.some((line) => line.name === "Continue")).toBe(
        true,
      );
      expect(image.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );

      // The gate is the Host's, not the browser's: a policy the deployment
      // set has to hold on a browser it did not start either — both the
      // destination asked for and the redirect Chromium decides to follow.
      await expect(
        manager.navigate("attach-session", tabId, {
          url: `http://localhost:${String(fixturePort)}/`,
        }),
      ).rejects.toMatchObject({ code: "BROWSER_HOST_BLOCKED" });
      await expect(
        manager.navigate("attach-session", tabId, {
          url: `http://127.0.0.1:${String(fixturePort)}/redirect-denied`,
        }),
      ).rejects.toMatchObject({ code: "BROWSER_HOST_BLOCKED" });

      // The promise attach mode exists to keep: our teardown closes the
      // session's own context and drops the link, while the browser — which
      // someone else started, possibly with their own tabs in it — stays up.
      await manager.dispose();
      const endpoint = await fetch(
        `http://127.0.0.1:${String(debugPort)}/json/version`,
      );
      expect(endpoint.ok).toBe(true);
      const targets = (await (
        await fetch(`http://127.0.0.1:${String(debugPort)}/json/list`)
      ).json()) as { type: string; url: string }[];
      const pageUrls = targets
        .filter((target) => target.type === "page")
        .map((target) => target.url);
      expect(pageUrls).toContain(personUrl);
      expect(pageUrls).not.toContain(
        `http://127.0.0.1:${String(fixturePort)}/`,
      );
    } finally {
      await stopExternalChromium(external.child, debugPort);
      await removeProfileDir(external.userDataDir);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120_000);

  it("joins a browser through a ws endpoint pinned to one address", async () => {
    // §3.3 tells a deployment that must pin the browser it dials to write a `ws`
    // URL: an `http` endpoint is only a question, and the answer names the
    // address to dial next. That form is a different branch of Playwright's own
    // connect step — it takes the URL it was given and asks no server where to
    // go — so the unit fake, which only records the string it was handed,
    // cannot tell a working endpoint from one that never dials. A real browser
    // answers that, and answers the other half too: the loopback `ws` URL the
    // gate is documented to accept without the remote switch.
    const executable = discoverChromium();
    const debugPort = await freePort();
    const external = await startExternalChromium(executable, debugPort);
    const probe = await startProbeServer({
      "/": await readFile(
        new URL("./fixtures/app.html", import.meta.url),
        "utf8",
      ),
    });
    try {
      const { webSocketDebuggerUrl } = (await (
        await fetch(`http://127.0.0.1:${String(debugPort)}/json/version`)
      ).json()) as { webSocketDebuggerUrl?: string };
      expect(typeof webSocketDebuggerUrl).toBe("string");
      const endpoint = webSocketDebuggerUrl!;

      const config = resolveQaBrowserConfig({
        runtime: { mode: "attach", cdpEndpoint: endpoint },
      });
      const manager = new QaBrowserSessionManager({
        config,
        provider: new PlaywrightBrowserProvider(),
        policy: new BrowserNetworkPolicy(config.security.network),
        startIdleTimer: false,
      });
      managers.push(manager);

      const session = await manager.ensureSession("attach-pinned-ws");
      const tabId = session.selectedTabId!;
      const pageUrl = `http://127.0.0.1:${String(probe.port)}/`;
      const result = await manager.navigate("attach-pinned-ws", tabId, {
        url: pageUrl,
      });
      expect(result).toMatchObject({ ok: true, title: "QA Browser fixture" });

      // The page this session drives is a target of the browser behind that
      // endpoint — which is the only reading that tells a joined browser apart
      // from one the runtime started for itself and never showed anyone.
      const listed = (await (
        await fetch(`http://127.0.0.1:${String(debugPort)}/json/list`)
      ).json()) as { type: string; url: string }[];
      expect(
        listed.filter((target) => target.type === "page").map((t) => t.url),
      ).toContain(pageUrl);

      // Same promise as the `http` case, on the endpoint form that recommendation
      // points at: the link and our own context go, the browser does not.
      await manager.dispose();
      const stillUp = await fetch(
        `http://127.0.0.1:${String(debugPort)}/json/version`,
      );
      expect(stillUp.ok).toBe(true);
    } finally {
      await stopExternalChromium(external.child, debugPort);
      await removeProfileDir(external.userDataDir);
      await probe.close();
    }
  }, 120_000);

  it("reads a killed attached browser as a dropped link, never as a crash", async () => {
    const executable = discoverChromium();
    const debugPort = await freePort();
    const external = await startExternalChromium(executable, debugPort);
    try {
      const config = resolveQaBrowserConfig({
        runtime: {
          mode: "attach",
          cdpEndpoint: `http://127.0.0.1:${String(debugPort)}`,
        },
      });
      const manager = new QaBrowserSessionManager({
        config,
        provider: new PlaywrightBrowserProvider(),
        policy: new BrowserNetworkPolicy(config.security.network),
        startIdleTimer: false,
      });
      managers.push(manager);
      const session = await manager.ensureSession("attach-dropped");
      const tabId = session.selectedTabId!;

      // The browser a person started dies while our session is open. No fake
      // stands in here: the disconnect arrives as a real socket closing, on
      // Playwright's own schedule, so the wait below is for the event rather
      // than for the process.
      external.child.kill();
      await waitForExit(external.child);

      const deadline = Date.now() + 15_000;
      while (manager.getSession("attach-dropped")?.status !== "disconnected") {
        if (Date.now() > deadline) {
          throw new Error(
            `the dropped link was never reported: the session stayed ` +
              `${String(manager.getSession("attach-dropped")?.status)}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // An operator reading the panel is told the link to *their* browser went
      // away, not that a Chromium this plugin never started has crashed, and the
      // runtime refuses to offer the tabs that were in it.
      expect(manager.getSession("attach-dropped")).toMatchObject({
        status: "disconnected",
        selectedTabId: null,
        tabIds: [],
      });
      await expect(
        manager.snapshot("attach-dropped", tabId),
      ).rejects.toMatchObject({ code: "BROWSER_CONNECTION_LOST" });
    } finally {
      await stopExternalChromium(external.child, debugPort);
      await removeProfileDir(external.userDataDir);
    }
  }, 120_000);

  it("answers only the endpoint forms the browser itself accepts", async () => {
    // §3.3 and DOCKER.md both leave the endpoint to the deployment, and Chromium
    // decides what it answers before this runtime is involved at all: the
    // DevTools server checks the request's `Host` header, and the origin of an
    // upgrade, while `allowRemoteCdpEndpoint` only opens the config gate and
    // Playwright then dials whatever it was given. So the address shape a sidecar
    // guide sends an operator to, and what a flag named in that guide opens, are
    // the browser's answers, which is what is measured here.
    const executable = discoverChromium();
    const debugPort = await freePort();
    const port = String(debugPort);
    const external = await startExternalChromium(executable, debugPort);
    try {
      const ask = await devToolsHostProbe(debugPort);
      // What answers: an address, the one name Chromium recognises, and any IP —
      // the header has to parse as an address, not belong to this machine.
      expect(await ask({ host: `127.0.0.1:${port}` })).toBe(200);
      expect(await ask({ host: `localhost:${port}` })).toBe(200);
      expect(await ask({ host: `203.0.113.20:${port}` })).toBe(200);
      expect(await ask({ host: `127.0.0.1:${port}`, socket: true })).toBe(101);
      // What does not: the compose service name the sidecar shape writes, on
      // both hops, so a pinned `ws` URL gets around nothing.
      expect(await ask({ host: `chromium:${port}` })).toBeGreaterThanOrEqual(
        400,
      );
      expect(
        await ask({ host: `chromium:${port}`, socket: true }),
      ).toBeGreaterThanOrEqual(400);
      // And what the disowned switch is really about: an upgrade carrying the
      // `Origin` of a page, which is how a web page dials the browser it runs in.
      // Without the flag the browser turns that request away, while the same
      // `Origin` on the `/json/version` question is answered — the guard sits on
      // the upgrade, where a page actually reaches the browser.
      expect(
        await ask({ host: `127.0.0.1:${port}`, origin: PAGE_ORIGIN }),
      ).toBe(200);
      expect(
        await ask({
          host: `127.0.0.1:${port}`,
          socket: true,
          origin: PAGE_ORIGIN,
        }),
      ).toBeGreaterThanOrEqual(400);

      // The same guide then disowns that switch: `--remote-allow-origins` "guards
      // the `Origin` header", so a name in `Host` stays refused with it set. That
      // is a claim about a browser started with the flag, and nothing else in this
      // suite ever starts one, so it is asked here of a second Chromium that has
      // it. Left unmeasured, the sentence would only ever have been read off
      // browsers that never had the flag — and a flag that did move the `Host`
      // check would still be sending every sidecar guide to an address rather than
      // to a name.
      const flaggedPort = await freePort();
      const flagged = await startExternalChromium(executable, flaggedPort, [
        "--remote-allow-origins=*",
      ]);
      try {
        const askFlagged = await devToolsHostProbe(flaggedPort);
        const flaggedAddress = `127.0.0.1:${String(flaggedPort)}`;
        const flaggedName = `chromium:${String(flaggedPort)}`;
        // This Chromium is up and answers its own address on both hops, so the
        // refusals below are its judgment about the headers rather than a browser
        // that never came up.
        expect(await askFlagged({ host: flaggedAddress })).toBe(200);
        expect(await askFlagged({ host: flaggedAddress, socket: true })).toBe(
          101,
        );
        // The one reading that separates the two processes, and so the control
        // that the flag reached this one: the page-origin upgrade the unflagged
        // browser refused is carried through here. Ask without it and every
        // assertion in this case holds for a browser started with no flag at all,
        // and the two sentences below would be read off a browser that never had
        // the switch the guide is talking about.
        expect(
          await askFlagged({
            host: flaggedAddress,
            socket: true,
            origin: PAGE_ORIGIN,
          }),
        ).toBe(101);
        // What the flag does not move: the name is refused with it set, on both
        // hops, exactly as it was without it.
        expect(await askFlagged({ host: flaggedName })).toBeGreaterThanOrEqual(
          400,
        );
        expect(
          await askFlagged({ host: flaggedName, socket: true }),
        ).toBeGreaterThanOrEqual(400);
      } finally {
        await stopExternalChromium(flagged.child, flaggedPort);
        await removeProfileDir(flagged.userDataDir);
      }
    } finally {
      await stopExternalChromium(external.child, debugPort);
      await removeProfileDir(external.userDataDir);
    }
  }, 120_000);

  it("denies a refused WebSocket handshake on a browser it only joined", async () => {
    // The docs promise the session's request path is the same in both modes, and
    // a socket is the half a launched browser cannot answer for: the route is
    // installed on a context Playwright did not build, over a connection it did
    // not open. The unit suite registers the handler and calls it itself, so
    // only a real attached browser shows whether the browser honors it.
    await withAttachedChromium(async (endpoint) => {
      const html = await readFile(
        new URL("./fixtures/ws-probe.html", import.meta.url),
        "utf8",
      );
      const probe = await startProbeServer({ "/probe": html });
      try {
        const config = socketProbeConfig(["http", "https"], endpoint);
        const policy = new RecordingPolicy(config.security.network);
        const manager = new QaBrowserSessionManager({
          config,
          provider: new PlaywrightBrowserProvider(),
          policy,
          startIdleTimer: false,
        });
        managers.push(manager);
        const session = await manager.ensureSession("attach-ws-denied");
        const tabId = session.selectedTabId!;
        await manager.navigate("attach-ws-denied", tabId, {
          url: `http://127.0.0.1:${probe.port}/probe`,
        });
        await manager.wait("attach-ws-denied", tabId, {
          text: "closed",
          timeoutMs: 15_000,
        });

        // Same reading as the launched case: the gate saw the socket, and the
        // server it points at was never offered a handshake.
        expect(policy.asked).toContain(`ws://127.0.0.1:${probe.port}/feed`);
        expect(probe.upgrades).toEqual([]);
      } finally {
        await probe.close();
      }
    });
  }, 120_000);

  it("carries a WebSocket the policy allows on a browser it only joined", async () => {
    // The refused handshake above is the half the gate is judged on, and it is
    // the easy half: not connecting is something this runtime does by itself. A
    // socket the policy lets through is the other direction, and only Playwright
    // can serve it — `connectToServer()` hands the page's traffic back to a
    // browser this runtime neither started nor created the context of. Whether
    // that relay works over a joined CDP connection is the browser's answer: a
    // session whose permitted sockets silently died would be broken in the one
    // mode this card ships while every other attach case stayed green.
    await withAttachedChromium(async (endpoint) => {
      const html = await readFile(
        new URL("./fixtures/ws-probe.html", import.meta.url),
        "utf8",
      );
      const probe = await startProbeServer({ "/probe": html });
      try {
        const config = socketProbeConfig(["http", "https", "ws"], endpoint);
        const manager = new QaBrowserSessionManager({
          config,
          provider: new PlaywrightBrowserProvider(),
          policy: new BrowserNetworkPolicy(config.security.network),
          startIdleTimer: false,
        });
        managers.push(manager);
        const session = await manager.ensureSession("attach-ws-allowed");
        const tabId = session.selectedTabId!;
        await manager.navigate("attach-ws-allowed", tabId, {
          url: `http://127.0.0.1:${probe.port}/probe`,
        });
        // The frame the probe pushes after the handshake reaches the page
        // through the joined browser, so the gate let the socket through rather
        // than swallowing it.
        await manager.wait("attach-ws-allowed", tabId, {
          text: "message:ready",
          timeoutMs: 15_000,
        });

        expect(probe.upgrades).toEqual(["/feed"]);
      } finally {
        await probe.close();
      }
    });
  }, 120_000);

  it("keeps a service worker of a joined browser from dialing past the gate", async () => {
    // §17 lets no worker run in a policy-gated context because a worker dials
    // from outside page routing. Keeping it out is a context option handed to a
    // browser this runtime did not start, so the rule is read back on the borrowed
    // browser too, with every scheme open: what is being tested is the gate's
    // reach rather than the answer it would give. Whether the silence comes from
    // that option or from the joined browser is the launched case's question; this
    // one asks only that no request of a session on a borrowed browser reaches the
    // network past the gate.
    await withAttachedChromium(async (endpoint) => {
      const html = await readFile(
        new URL("./fixtures/sw-probe.html", import.meta.url),
        "utf8",
      );
      const probe = await startProbeServer({ "/sw-probe": html });
      try {
        const config = socketProbeConfig(["http", "https", "ws"], endpoint);
        const policy = new RecordingPolicy(config.security.network);
        const manager = new QaBrowserSessionManager({
          config,
          provider: new PlaywrightBrowserProvider(),
          policy,
          startIdleTimer: false,
        });
        managers.push(manager);
        const session = await manager.ensureSession("attach-sw-probe");
        const tabId = session.selectedTabId!;
        await manager.navigate("attach-sw-probe", tabId, {
          url: `http://127.0.0.1:${probe.port}/sw-probe`,
        });
        await manager.wait("attach-sw-probe", tabId, {
          text: "no-worker",
          timeoutMs: 15_000,
        });

        expect(policy.asked.filter((url) => url.includes("/worker-"))).toEqual(
          [],
        );
        expect(probe.requests).toEqual([]);
        expect(probe.upgrades).toEqual([]);
      } finally {
        await probe.close();
      }
    });
  }, 120_000);

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
      const config = socketProbeConfig(["http", "https"], null);
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
      const config = socketProbeConfig(["http", "https", "ws"], null);
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
      const config = socketProbeConfig(["http", "https", "ws"], null);
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
