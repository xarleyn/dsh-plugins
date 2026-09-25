import path from "node:path";

import { describe, expect, it } from "vitest";

import { QA_BROWSER_DEFAULTS, resolveQaBrowserConfig } from "../src/config.js";

describe("resolveQaBrowserConfig", () => {
  it("uses the secure runtime defaults from the specification", () => {
    expect(resolveQaBrowserConfig()).toEqual(QA_BROWSER_DEFAULTS);
  });

  it("normalizes policy lists and clamps resource limits", () => {
    const config = resolveQaBrowserConfig({
      runtime: {
        actionTimeoutMs: 1,
        navigationTimeoutMs: 999_999,
        idleTimeoutMinutes: 0,
      },
      session: { maxTabs: 500 },
      humanControl: { leaseSeconds: 999 },
      security: {
        network: {
          allowedSchemes: ["HTTPS:", "https", " http "],
          allowHosts: ["LOCALHOST", "localhost"],
          dshOrigins: ["https://DSH.EXAMPLE/app"],
        },
      },
    });

    expect(config.runtime).toMatchObject({
      chromiumSandbox: true,
      actionTimeoutMs: 250,
      navigationTimeoutMs: 180_000,
      idleTimeoutMs: 60_000,
    });
    expect(config.session.maxTabs).toBe(32);
    expect(config.humanControl).toEqual({
      enabled: true,
      leaseSeconds: 300,
      leaseMs: 300_000,
    });
    expect(config.security.network.allowedSchemes).toEqual(["https", "http"]);
    expect(config.security.network.allowHosts).toEqual(["localhost"]);
    expect(config.security.network.dshOrigins).toEqual(["https://dsh.example"]);
  });

  it("rejects non-origin self-deny entries", () => {
    expect(() =>
      resolveQaBrowserConfig({
        security: { network: { dshOrigins: ["not an origin"] } },
      }),
    ).toThrow();
  });

  it("rejects relative executable paths", () => {
    expect(() =>
      resolveQaBrowserConfig({
        runtime: { executablePath: path.join("relative", "chrome") },
      }),
    ).toThrow(/must be absolute/u);
  });

  it("starts its own browser unless the deployment names one to join", () => {
    expect(resolveQaBrowserConfig().runtime).toMatchObject({
      mode: "launch",
      cdpEndpoint: null,
    });
    expect(() =>
      resolveQaBrowserConfig({ runtime: { mode: "attach" } }),
    ).toThrow(/cdpEndpoint is required when runtime.mode is attach/u);
    // An endpoint the runtime never dials is a deployment that believes it is
    // attaching while it is, in fact, starting its own browser.
    expect(() =>
      resolveQaBrowserConfig({
        runtime: { cdpEndpoint: "http://127.0.0.1:9222" },
      }),
    ).toThrow(/only used when runtime.mode is attach/u);
  });

  it("accepts the endpoint forms Playwright dials", () => {
    for (const cdpEndpoint of [
      "http://127.0.0.1:9222",
      "http://localhost:9222/json/version",
      "http://[::1]:9222",
      "https://chrome.localhost:9222",
      "ws://127.0.0.1:9222/devtools/browser/6c1a2b3c",
    ]) {
      const config = resolveQaBrowserConfig({
        runtime: { mode: "attach", cdpEndpoint },
      });
      expect(config.runtime).toMatchObject({ mode: "attach", cdpEndpoint });
    }
    for (const cdpEndpoint of [
      "127.0.0.1:9222",
      "devtools://browser",
      "file:///run/chromium/devtools.sock",
    ]) {
      expect(() =>
        resolveQaBrowserConfig({ runtime: { mode: "attach", cdpEndpoint } }),
      ).toThrow(/must be an HTTP\(S\) or WS\(S\) URL/u);
    }
  });

  it("keeps a debug endpoint on this machine until the deployment opens it", () => {
    // A CDP endpoint is full control of a browser, so anything beyond loopback
    // has to be a decision someone wrote down.
    for (const cdpEndpoint of [
      "http://build-host:9222",
      "http://10.0.0.5:9222",
      "ws://192.168.1.20:9222/devtools/browser/6c1a2b3c",
    ]) {
      expect(() =>
        resolveQaBrowserConfig({ runtime: { mode: "attach", cdpEndpoint } }),
      ).toThrow(/outside this machine/u);
      expect(
        resolveQaBrowserConfig({
          runtime: {
            mode: "attach",
            cdpEndpoint,
            allowRemoteCdpEndpoint: true,
          },
        }).runtime.cdpEndpoint,
      ).toBe(cdpEndpoint);
    }
    expect(() =>
      resolveQaBrowserConfig({
        runtime: { cdpEndpoint: "http://build-host:9222" },
      }),
    ).toThrow(/only used when runtime.mode is attach/u);
  });

  it("does not let attach promise a window it cannot show", () => {
    expect(() =>
      resolveQaBrowserConfig({
        runtime: {
          mode: "attach",
          cdpEndpoint: "http://127.0.0.1:9222",
          headless: false,
        },
      }),
    ).toThrow(/headless cannot be false when runtime.mode is attach/u);
    expect(
      resolveQaBrowserConfig({ runtime: { headless: false } }).runtime,
    ).toMatchObject({ mode: "launch", headless: false });
  });
});
