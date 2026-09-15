import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { resolveQaBrowserConfig } from "../src/config.js";
import { BrowserNetworkPolicy } from "../src/host/policy.js";
import { PlaywrightBrowserProvider } from "../src/host/providers/playwright.js";
import { QaBrowserSessionManager } from "../src/host/session-manager.js";

const enabled = process.env["DSH_QA_BROWSER_E2E"] === "1";

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
      await manager.humanKey(
        "integration-session",
        tabId,
        "panel-e2e",
        "Tab",
      );
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
});
