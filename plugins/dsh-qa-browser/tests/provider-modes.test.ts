import { describe, expect, it, vi } from "vitest";

import { resolveQaBrowserConfig } from "../src/config.js";
import { QaBrowserError } from "../src/errors.js";
import { PlaywrightBrowserProvider } from "../src/host/providers/playwright.js";
import type { BrowserContextOptions } from "../src/host/providers/contract.js";

type PlaywrightModule = typeof import("playwright");

/** The page's `new WebSocket(url)`, as the provider's socket route sees it. */
class FakeSocketRoute {
  connections = 0;
  readonly closures: { code?: number; reason?: string }[] = [];

  constructor(private readonly target: string) {}

  url(): string {
    return this.target;
  }

  protocols(): string[] {
    return [];
  }

  connectToServer(): FakeSocketRoute {
    this.connections += 1;
    return this;
  }

  async close(options: { code?: number; reason?: string } = {}): Promise<void> {
    this.closures.push(options);
  }
}

/**
 * A context of someone else's browser: what the provider is handed after it
 * joins over CDP, and the thing it has to gate before it drives anything.
 */
class FakeContext {
  readonly events: string[] = [];
  closeCalls = 0;
  private socketHandler?: (socket: FakeSocketRoute) => Promise<void>;

  setDefaultTimeout(_timeoutMs: number): void {}

  setDefaultNavigationTimeout(_timeoutMs: number): void {}

  async route(_pattern: string, _handler: unknown): Promise<void> {
    this.events.push("route");
  }

  async routeWebSocket(
    _pattern: unknown,
    handler: (socket: FakeSocketRoute) => Promise<void>,
  ): Promise<void> {
    this.events.push("route-web-socket");
    this.socketHandler = handler;
  }

  pages(): never[] {
    return [];
  }

  async newPage(): Promise<Record<string, never>> {
    this.events.push("new-page");
    return {};
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

  /** The page's `new WebSocket(url)`, as the provider's handler sees it. */
  async dial(url: string): Promise<FakeSocketRoute> {
    const socket = new FakeSocketRoute(url);
    await this.socketHandler?.(socket);
    return socket;
  }
}

/** The slice of Playwright's `Browser` this provider talks to. */
class FakeBrowser {
  connected = true;
  /** Counts `close()`, which kills our own process and only unlinks from theirs. */
  closed = 0;
  /** The contexts this runtime built on the browser. */
  readonly created: FakeContext[] = [];
  /**
   * The owner's own context: an attached browser always has one, and it holds
   * the tabs a person is looking at. Playwright hands it out through
   * `contexts()`, so the fake hands it out too — and counts the times anyone
   * asks, because taking it would mean driving those tabs.
   */
  readonly ownerContext = new FakeContext();
  contextsAsked = 0;
  /** What the provider asked Chromium to build the context with. */
  contextOptions: Record<string, unknown> = {};
  private readonly disconnectListeners: (() => void)[] = [];

  isConnected(): boolean {
    return this.connected;
  }

  once(event: "disconnected", listener: () => void): void {
    expect(event).toBe("disconnected");
    this.disconnectListeners.push(listener);
  }

  contexts(): FakeContext[] {
    this.contextsAsked += 1;
    return [this.ownerContext, ...this.created];
  }

  async newContext(options: Record<string, unknown>): Promise<FakeContext> {
    this.contextOptions = options;
    const context = new FakeContext();
    this.created.push(context);
    return context;
  }

  close(): void {
    this.closed += 1;
    this.connected = false;
    // A real Chromium announces the closure it was asked for, and a runtime
    // that is already stopping must not read that as the browser going away.
    const listeners = this.disconnectListeners.splice(0);
    for (const listener of listeners) listener();
  }

  /** The browser went away on its own: our process died, or the link dropped. */
  drop(): void {
    this.connected = false;
    for (const listener of this.disconnectListeners.splice(0)) listener();
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

function contextOptions(
  overrides: Partial<BrowserContextOptions> = {},
): BrowserContextOptions {
  return {
    sessionId: "session-x",
    viewport: { width: 1_280, height: 720, deviceScaleFactor: 1 },
    actionTimeoutMs: 1_000,
    navigationTimeoutMs: 1_000,
    validateRequest: async () => undefined,
    ...overrides,
  };
}

const ATTACH_CONFIG = resolveQaBrowserConfig({
  runtime: { mode: "attach", cdpEndpoint: "http://127.0.0.1:9222" },
});

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

    await provider.start(ATTACH_CONFIG.runtime);

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
    const seen = crashes(provider);

    await provider.start(ATTACH_CONFIG.runtime);
    browser.drop();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(QaBrowserError);
    expect(seen[0]?.code).toBe("BROWSER_CONNECTION_LOST");
    // The browser may well still be running, so the next session asks for a
    // fresh link rather than declaring the runtime unstartable.
    await provider.start(ATTACH_CONFIG.runtime);
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

    await provider.start(ATTACH_CONFIG.runtime);
    browser.drop();

    await expect(
      provider.createContext(contextOptions()),
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

    await expect(provider.start(ATTACH_CONFIG.runtime)).rejects.toMatchObject({
      code: "BROWSER_START_FAILED",
      message: /CDP endpoint.*ECONNREFUSED/u,
    });
  });

  it("gates the contexts it builds on an attached browser", async () => {
    const browser = new FakeBrowser();
    const playwright = fakePlaywright(browser);
    const provider = new PlaywrightBrowserProvider(
      async () => playwright.module,
    );
    const asked: string[] = [];

    await provider.start(ATTACH_CONFIG.runtime);
    await provider.createContext(
      contextOptions({
        validateRequest: async (url) => {
          asked.push(url);
          throw new QaBrowserError(
            "BROWSER_HOST_BLOCKED",
            "Blocked by policy.",
          );
        },
      }),
    );

    // The context below is built on the browser we joined, not on one we fell
    // back to starting: the entry point is the difference between the modes.
    expect(playwright.connectOverCDP).toHaveBeenCalledTimes(1);
    expect(playwright.launch).not.toHaveBeenCalled();

    // Joining someone else's browser does not relax what we do inside it: the
    // context is still built with downloads and service workers off, and every
    // destination is still asked about before the socket leaves.
    expect(browser.contextOptions).toMatchObject({
      acceptDownloads: false,
      serviceWorkers: "block",
      viewport: { width: 1_280, height: 720 },
      deviceScaleFactor: 1,
    });
    expect(browser.created[0]?.events).toEqual(["route", "route-web-socket"]);

    const socket = await browser.created[0]?.dial("ws://127.0.0.1:9/auth");
    expect(asked).toEqual(["ws://127.0.0.1:9/auth"]);
    expect(socket?.connections).toBe(0);
    expect(socket?.closures[0]?.code).toBe(1008);
    await provider.stop();
  });

  it("closes its own contexts and reports no loss when it stops an attached browser", async () => {
    const browser = new FakeBrowser();
    const playwright = fakePlaywright(browser);
    const provider = new PlaywrightBrowserProvider(
      async () => playwright.module,
    );
    const seen = crashes(provider);

    await provider.start(ATTACH_CONFIG.runtime);
    await provider.createContext(contextOptions());
    await provider.createContext(contextOptions({ sessionId: "session-y" }));
    expect(browser.created).toHaveLength(2);

    await provider.stop();

    // Exactly the two contexts this runtime asked for, and one link dropped:
    // the closure we requested is Playwright's own, so the browser is still
    // there for its owner and nothing tells the operator it went away.
    expect(browser.created.map((context) => context.closeCalls)).toEqual([
      1, 1,
    ]);
    expect(browser.closed).toBe(1);
    expect(seen).toEqual([]);
  });

  it("leaves the context the browser came with alone", async () => {
    const browser = new FakeBrowser();
    const playwright = fakePlaywright(browser);
    const provider = new PlaywrightBrowserProvider(
      async () => playwright.module,
    );

    await provider.start(ATTACH_CONFIG.runtime);
    await provider.createContext(contextOptions());
    await provider.stop();

    // SPEC §5 keeps "controlling arbitrary existing user tabs" a non-goal, and
    // an attached browser arrives with exactly such tabs. They are reachable
    // through `contexts()[0]`, which is why the runtime never asks: a session
    // lives in a context it created and closes no other.
    expect(browser.contextsAsked).toBe(0);
    expect(browser.ownerContext.closeCalls).toBe(0);
    expect(browser.ownerContext.events).toEqual([]);
  });
});
