import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { chromium } from "playwright";

import { resolveQaBrowserConfig } from "../src/config.js";
import { BrowserNetworkPolicy } from "../src/host/policy.js";
import { PlaywrightBrowserProvider } from "../src/host/providers/playwright.js";
import { QaBrowserSessionManager } from "../src/host/session-manager.js";

import { withAttachedChromium } from "./external-chromium.helpers.js";

const enabled = process.env["DSH_QA_BROWSER_E2E"] === "1";

/**
 * A server that answers every path with the storage fixture and records what it
 * was asked for. The record is what makes the refusal half of the case honest:
 * a tab that rendered the page proves the document came off this server, not
 * out of the browser's own memory of the other one.
 */
async function startStorageServer(): Promise<{
  readonly origin: string;
  readonly hits: string[];
  readonly close: () => Promise<void>;
}> {
  const html = await readFile(
    new URL("./fixtures/storage-probe.html", import.meta.url),
    "utf8",
  );
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(request.url ?? "");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    hits,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    },
  };
}

describe.skipIf(!enabled)(
  "Playwright Browser runtime beside another driver",
  () => {
    const managers: QaBrowserSessionManager[] = [];

    afterEach(async () => {
      await Promise.allSettled(
        managers.splice(0).map((manager) => manager.dispose()),
      );
    });

    it("shares a borrowed browser with another driver without sharing a session or a gate", async () => {
      // §3.3 and §19.1 say what coexisting with the Harness's own browser tool
      // looks like: one Chromium, two drivers, and neither the session's state
      // nor this runtime's network gates crossing between them. Both halves are
      // the browser's answer, not this code's — a fake hands over whatever
      // object it was built with, so it can neither leak the owner's cookies
      // into a session nor let a tab out of a route it never installed. They are
      // read off a live browser here, against the driver shape the section
      // names: a second connection to the same endpoint, in the context that
      // browser arrived with — a `browser_use` page of the Harness, or a page a
      // person opened.
      await withAttachedChromium(async (endpoint) => {
        const shared = await startStorageServer();
        const refused = await startStorageServer();
        const harness = await chromium.connectOverCDP(endpoint);
        try {
          const owner = await harness.contexts()[0]!.newPage();
          await owner.goto(`${shared.origin}/probe?set=owner`);
          expect(await owner.textContent("#outcome")).toBe(
            "state: cookie=owner storage=owner",
          );

          const config = resolveQaBrowserConfig({
            runtime: { mode: "attach", cdpEndpoint: endpoint },
            security: { network: { dshOrigins: [refused.origin] } },
          });
          const manager = new QaBrowserSessionManager({
            config,
            provider: new PlaywrightBrowserProvider(),
            policy: new BrowserNetworkPolicy(config.security.network, {
              dshOrigins: config.security.network.dshOrigins,
            }),
            startIdleTimer: false,
          });
          managers.push(manager);
          const session = await manager.ensureSession("attach-coexist");
          const tabId = session.selectedTabId!;
          // The same page, read through this runtime's own session API, so what
          // follows is what a session of this plugin sees — not what the driver
          // that built the page happens to hold.
          const read = async (): Promise<string> => {
            const snapshot = await manager.snapshot("attach-coexist", tabId, {
              mode: "document",
            });
            const line = snapshot.lines.find((candidate) =>
              (candidate.text ?? candidate.name).startsWith("state:"),
            );
            return line === undefined ? "" : (line.text ?? line.name);
          };

          // The session's context is its own: on the very origin that other tab
          // wrote to it finds neither a cookie nor a stored value, which is
          // §19.1's promise that an attached browser's own logins are neither
          // taken up for a session nor read by one. Handing the session the
          // context it came with would turn this line into `cookie=owner`.
          await manager.navigate("attach-coexist", tabId, {
            url: `${shared.origin}/probe`,
          });
          expect(await read()).toBe("state: cookie=none storage=none");

          // And what a session writes stays inside it: after this runtime's own
          // marker lands, the other driver's tab on the same origin still reads
          // only what it put there.
          await manager.navigate("attach-coexist", tabId, {
            url: `${shared.origin}/probe?set=session`,
          });
          expect(await read()).toBe("state: cookie=session storage=session");
          await owner.goto(`${shared.origin}/probe`);
          expect(await owner.textContent("#outcome")).toBe(
            "state: cookie=owner storage=owner",
          );

          // The gates sit in this runtime's request path and nowhere else: the
          // origin §17.3 blocks for a session of this plugin is served to a tab
          // this plugin did not build. A route installed on every context of the
          // borrowed browser — the reading this paragraph rules out — would
          // refuse the navigation below instead of loading it.
          await expect(
            manager.navigate("attach-coexist", tabId, {
              url: `${refused.origin}/probe`,
            }),
          ).rejects.toMatchObject({ code: "BROWSER_DSH_ORIGIN_BLOCKED" });
          // The refusal kept the request off the network instead of reporting a
          // failure after fetching, and the server answers the other tab.
          expect(refused.hits).toEqual([]);
          await owner.goto(`${refused.origin}/probe`);
          expect(refused.hits).toContain("/probe");
        } finally {
          await harness.close();
          await shared.close();
          await refused.close();
        }
      });
    }, 120_000);
  },
);
