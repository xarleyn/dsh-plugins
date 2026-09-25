import { describe, expect, it, vi } from "vitest";

import { resolveQaBrowserConfig } from "../src/config.js";
import { QaBrowserError } from "../src/errors.js";
import { PlaywrightBrowserProvider } from "../src/host/providers/playwright.js";

type PlaywrightModule = typeof import("playwright");

/** The slice of Playwright's `Browser` this provider talks to. */
class FakeBrowser {
  connected = true;
  /** Counts `close()`, which kills our own process and only unlinks from theirs. */
  closed = 0;
  private readonly disconnectListeners: (() => void)[] = [];

  isConnected(): boolean {
    return this.connected;
  }

  once(event: "disconnected", listener: () => void): void {
    expect(event).toBe("disconnected");
    this.disconnectListeners.push(listener);
  }

  close(): void {
    this.closed += 1;
    this.connected = false;
  }

  /** The browser went away on its own: our process died, or the link dropped. */
  drop(): void {
    this.connected = false;
    for (const listener of this.disconnectListeners) listener();
  }
}

function fakePlaywright(browser: FakeBrowser | Error): {
  readonly module: PlaywrightModule;
  readonly launch: ReturnType<typeof vi.fn>;
  readonly connectOverCDP: ReturnType<typeof vi.fn>;
} {
  const launch = vi.fn(async () => {
    if (browser instanceof Error) throw browser;
    return browser;
  });
  const connectOverCDP = vi.fn(async () => {
    if (browser instanceof Error) throw browser;
    return browser;
  });
  return {
    module: {
      chromium: {
        launch,
        connectOverCDP,
        executablePath: () => "/nonexistent/chromium",
      },
    } as unknown as PlaywrightModule,
    launch,
    connectOverCDP,
  };
}

function crashes(provider: PlaywrightBrowserProvider): QaBrowserError[] {
  const seen: QaBrowserError[] = [];
  provider.onCrash((error) => {
    seen.push(error as QaBrowserError);
  });
  return seen;
}

describe("PlaywrightBrowserProvider runtime modes", () => {
  it("starts and stops its own Chromium in launch mode", async () => {
    const browser = new FakeBrowser();
    const playwright = fakePlaywright(browser);
    const provider = new PlaywrightBrowserProvider(
      async () => playwright.module,
    );

    await provider.start(resolveQaBrowserConfig().runtime);

    expect(playwright.launch).toHaveBeenCalledTimes(1);
    expect(playwright.connectOverCDP).not.toHaveBeenCalled();
    await provider.stop();
    expect(browser.closed).toBe(1);
  });

  it("joins a running Chromium over its CDP endpoint in attach mode", async () => {
    const browser = new FakeBrowser();
    const playwright = fakePlaywright(browser);
    const provider = new PlaywrightBrowserProvider(
      async () => playwright.module,
    );
    const config = resolveQaBrowserConfig({
      runtime: { mode: "attach", cdpEndpoint: "http://127.0.0.1:9222" },
    });

    await provider.start(config.runtime);

    expect(playwright.connectOverCDP).toHaveBeenCalledWith(
      "http://127.0.0.1:9222",
    );
    // The browser is not ours to start, and stopping is not ours to decide:
    // Playwright's close() on an attached browser drops the link and the
    // contexts we created, and leaves the process — and the tabs a person has
    // open in it — alone.
    await provider.stop();
    expect(browser.closed).toBe(1);
    expect(playwright.launch).not.toHaveBeenCalled();
  });

  it("reports a lost CDP link as a dropped connection, not a crash", async () => {
    const browser = new FakeBrowser();
    const playwright = fakePlaywright(browser);
    const provider = new PlaywrightBrowserProvider(
      async () => playwright.module,
    );
    const config = resolveQaBrowserConfig({
      runtime: { mode: "attach", cdpEndpoint: "http://127.0.0.1:9222" },
    });
    const seen = crashes(provider);

    await provider.start(config.runtime);
    browser.drop();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(QaBrowserError);
    expect(seen[0]?.code).toBe("BROWSER_CONNECTION_LOST");
    // The browser may well still be running, so the next session asks for a
    // fresh link rather than declaring the runtime unstartable.
    await provider.start(config.runtime);
    expect(playwright.connectOverCDP).toHaveBeenCalledTimes(2);
  });

  it("reports its own browser dying as a crash", async () => {
    const browser = new FakeBrowser();
    const playwright = fakePlaywright(browser);
    const provider = new PlaywrightBrowserProvider(
      async () => playwright.module,
    );
    const seen = crashes(provider);

    await provider.start(resolveQaBrowserConfig().runtime);
    browser.drop();

    expect(seen.map((error) => error.code)).toEqual(["BROWSER_CRASHED"]);
  });

  it("refuses to build a context it has no browser for", async () => {
    const browser = new FakeBrowser();
    const playwright = fakePlaywright(browser);
    const provider = new PlaywrightBrowserProvider(
      async () => playwright.module,
    );
    const config = resolveQaBrowserConfig({
      runtime: { mode: "attach", cdpEndpoint: "http://127.0.0.1:9222" },
    });

    await provider.start(config.runtime);
    browser.drop();

    await expect(
      provider.createContext({
        sessionId: "session-x",
        viewport: { width: 1_280, height: 720, deviceScaleFactor: 1 },
        actionTimeoutMs: 1_000,
        navigationTimeoutMs: 1_000,
        validateRequest: async () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "BROWSER_START_FAILED",
      message: /not attached/u,
    });
  });

  it("says which endpoint it could not reach", async () => {
    const playwright = fakePlaywright(
      new Error("connect ECONNREFUSED 127.0.0.1:9222"),
    );
    const provider = new PlaywrightBrowserProvider(
      async () => playwright.module,
    );
    const config = resolveQaBrowserConfig({
      runtime: { mode: "attach", cdpEndpoint: "http://127.0.0.1:9222" },
    });

    await expect(provider.start(config.runtime)).rejects.toMatchObject({
      code: "BROWSER_START_FAILED",
      message: /CDP endpoint.*ECONNREFUSED/u,
    });
  });
});
