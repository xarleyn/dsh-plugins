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

  it("refuses a mode it does not know instead of defaulting it", () => {
    // A misspelt mode would otherwise take the launch path and resolve to a
    // config that still carries the word the deployment wrote.
    for (const mode of ["Attach", "connected", "sidecar", ""]) {
      expect(() =>
        resolveQaBrowserConfig({
          runtime: { mode } as unknown as { mode: "launch" | "attach" },
        }),
      ).toThrow(/runtime\.mode must be "launch" or "attach"/u);
    }
  });

  it("refuses a config that shapes a process attach mode has none of", () => {
    const endpoint = "http://127.0.0.1:9222";
    // Absolute on every platform: `executablePath` is checked for that first,
    // and a Windows-style path would read as relative on the Linux CI runner.
    const executable = path.resolve(process.cwd(), "chromium", "chrome.exe");
    for (const knobs of [
      { executablePath: executable },
      { browserChannel: "msedge" },
      { chromiumSandbox: false },
    ]) {
      expect(() =>
        resolveQaBrowserConfig({
          runtime: { mode: "attach", cdpEndpoint: endpoint, ...knobs },
        }),
      ).toThrow(/runtime\.mode attach starts none/u);
    }
    expect(() =>
      resolveQaBrowserConfig({
        runtime: {
          mode: "attach",
          cdpEndpoint: endpoint,
          executablePath: executable,
          browserChannel: "msedge",
          chromiumSandbox: false,
        },
      }),
    ).toThrow(
      /executablePath and runtime\.browserChannel and runtime\.chromiumSandbox/u,
    );
    // A deployment that spells out the defaults attach mode behaves as has to
    // keep working: the refusal is about a value that would have been ignored.
    expect(
      resolveQaBrowserConfig({
        runtime: {
          mode: "attach",
          cdpEndpoint: endpoint,
          browserChannel: "chromium",
          headless: true,
          chromiumSandbox: true,
        },
      }).runtime.mode,
    ).toBe("attach");
    // The same keys are the point of launch mode, so nothing is refused there.
    expect(
      resolveQaBrowserConfig({
        runtime: {
          executablePath: executable,
          browserChannel: "msedge",
          chromiumSandbox: false,
        },
      }).runtime.executablePath,
    ).toBe(executable);
  });

  it("accepts the endpoint forms Playwright dials", () => {
    // One case per member of `CDP_ENDPOINT_PROTOCOLS`, because the set is the
    // promise the README repeats: `https`/`wss` are how a sidecar names an
    // endpoint that is not plain text, and Playwright treats the two halves
    // differently — a `ws*` URL is dialed as written, while an `http*` one is
    // asked for `/json/version` first. Drop a scheme from the set and the case
    // that stands for it is the thing that has to redden.
    for (const cdpEndpoint of [
      "http://127.0.0.1:9222",
      "https://127.0.0.1:9222",
      "http://localhost:9222/json/version",
      "http://[::1]:9222",
      "ws://127.0.0.1:9222/devtools/browser/6c1a2b3c",
      "wss://127.0.0.1:9222/devtools/browser/6c1a2b3c",
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
    // has to be a decision someone wrote down. A `*.localhost` name belongs in
    // this list although it is *meant* to be loopback: this runtime never
    // resolves it, so a resolver that answers it elsewhere is a host like any
    // other, and only the written switch can accept that.
    for (const cdpEndpoint of [
      "http://build-host:9222",
      "https://chrome.localhost:9222",
      "http://203.0.113.20:9222",
      "ws://browser.net.example:9222/devtools/browser/6c1a2b3c",
      // A sidecar on another host is the shape DOCKER.md draws, and a TLS
      // endpoint is the better half of it; the switch still gates it, because
      // what the gate bounds is the address written down, not the cipher.
      "wss://chromium.net.example:9222/devtools/browser/6c1a2b3c",
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

    // The switch only speaks about an endpoint, and `launch` has none: writing
    // it would leave a config claiming a door the runtime does not open.
    // Writing the default the other way stays fine.
    expect(() =>
      resolveQaBrowserConfig({
        runtime: { mode: "launch", allowRemoteCdpEndpoint: true },
      }),
    ).toThrow(/allowRemoteCdpEndpoint only opens a runtime.cdpEndpoint/u);
    expect(
      resolveQaBrowserConfig({
        runtime: { mode: "launch", allowRemoteCdpEndpoint: false },
      }).runtime,
    ).toMatchObject({ mode: "launch", cdpEndpoint: null });
  });

  it("counts as local only the names whose answer this machine owns", () => {
    // The gate reads `URL.hostname`, so what is compared is the address that
    // will be dialed rather than the string that was typed: the parser has
    // already collapsed `2130706433`, `127.1` and `127.0.0.1.` into 127.0.0.1,
    // and has already parted `evil.example@127.0.0.1` into a credential and a
    // host. A trailing dot after a *name* survives all of that — `localhost.` is
    // a DNS query whose answer depends on the resolver and on libc, glibc reading
    // it from the hosts file while musl sends it out — so it joins the names that
    // only a written switch can accept.
    for (const cdpEndpoint of [
      "http://LOCALHOST:9222",
      "http://2130706433:9222",
      "http://127.1:9222",
      "ws://127.0.0.1.:9222/devtools/browser/6c1a2b3c",
      "http://evil.example@127.0.0.1:9222",
      "ws://[::1]:9222/devtools/browser/6c1a2b3c",
    ]) {
      expect(
        resolveQaBrowserConfig({ runtime: { mode: "attach", cdpEndpoint } })
          .runtime.cdpEndpoint,
      ).toBe(cdpEndpoint);
    }
    for (const cdpEndpoint of [
      "http://localhost.:9222",
      "http://localhost.:9222/json/version",
      "http://127.0.0.1.evil:9222",
      "http://0.0.0.0:9222",
      "ws://[::ffff:127.0.0.1]:9222/devtools/browser/6c1a2b3c",
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
