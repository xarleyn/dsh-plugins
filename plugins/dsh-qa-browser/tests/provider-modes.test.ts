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
   * `contexts()` — the one route a `Browser` handle offers, and the one
   * `connectOverCDP` documents — and the fake counts the times anyone asks,
   * because taking it would mean driving those tabs.
   */
  readonly ownerContext = new FakeContext();
  contextsAsked = 0;
  /** What the provider asked Chromium to build the context with. */
  contextOptions: Record<string, unknown> = {};
  /** Whether the runtime took the shortcut that skips `newContext`. */
  sharedPageAsked = 0;
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

  /**
   * Playwright's convenience entry: one call for a page, and the context behind it
   * is Playwright's to manage, not this runtime's — so it carries none of the
   * viewport, timeouts or network route this provider installs on the contexts it
   * builds, and it is not in the list `stop()` closes. The fake hands out a
   * context of exactly that kind, so a runtime that took the shortcut would be
   * driving an ungated page it cannot shut down.
   */
  async newPage(): Promise<FakeContext> {
    this.sharedPageAsked += 1;
    return new FakeContext();
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
          if (url !== "ws://127.0.0.1:9/auth") return;
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

    const refused = await browser.created[0]?.dial("ws://127.0.0.1:9/auth");
    expect(asked).toEqual(["ws://127.0.0.1:9/auth"]);
    expect(refused?.connections).toBe(0);
    expect(refused?.closures[0]?.code).toBe(1008);

    // The other half of the pair, which the refusal above cannot stand in for:
    // a destination the gate let through is handed to Playwright to relay rather
    // than dropped. Delete that relay and every assertion above still holds —
    // and the real browser measures this direction only in the opt-in run, so
    // the suite that runs on every `pnpm test` has to hold it here.
    const permitted = await browser.created[0]?.dial(
      "wss://feed.example/streams",
    );
    expect(asked).toEqual([
      "ws://127.0.0.1:9/auth",
      "wss://feed.example/streams",
    ]);
    expect(permitted?.connections).toBe(1);
    expect(permitted?.closures).toEqual([]);
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

  it("keeps the link when a session of an attached browser closes", async () => {
    const browser = new FakeBrowser();
    const playwright = fakePlaywright(browser);
    const provider = new PlaywrightBrowserProvider(
      async () => playwright.module,
    );
    const seen = crashes(provider);

    await provider.start(ATTACH_CONFIG.runtime);
    const first = await provider.createContext(contextOptions());
    const second = await provider.createContext(
      contextOptions({ sessionId: "session-b" }),
    );

    // §3.3 puts the boundary of a session close at that session's own context,
    // and a person's browser is on the other side of it: an agent finishing a
    // session must not stop the Chromium its owner opened, not even when it was
    // the last session this runtime had — the browser was up before it and stays
    // up after. The sibling case above covers the stop of the whole runtime,
    // which is the one place the link does drop.
    await provider.closeContext(first.id);
    await provider.closeContext(second.id);

    expect(browser.created.map((context) => context.closeCalls)).toEqual([
      1, 1,
    ]);
    expect(browser.closed).toBe(0);
    expect(browser.isConnected()).toBe(true);
    expect(seen).toEqual([]);

    // Still attached, so the next session is built on this browser rather than
    // on one the runtime falls back to starting.
    await provider.createContext(contextOptions({ sessionId: "session-c" }));
    expect(playwright.connectOverCDP).toHaveBeenCalledTimes(1);
    expect(playwright.launch).not.toHaveBeenCalled();

    await provider.stop();
    expect(browser.closed).toBe(1);
    expect(browser.created.map((context) => context.closeCalls)).toEqual([
      1, 1, 1,
    ]);
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
    // an attached browser arrives with exactly such tabs. A `Browser` handle
    // reaches the context it came with through `contexts()` only — asking for it
    // is the one way this runtime could drive or close a tab that is not its own
    // — and Playwright's convenience `newPage()` is the shortcut into that same
    // context. These two counts are the checks that can redden. Counting the
    // owner's `close()` on top of them would not: the only route to that handle
    // is the `contexts()` call the first line already forbids, so it stands for
    // any code whatever. Where a surviving owner tab is measured is the run no
    // fake stands in for — the real Chromium, read back over `/json/list`.
    expect(browser.contextsAsked).toBe(0);
    expect(browser.sharedPageAsked).toBe(0);
  });
});
