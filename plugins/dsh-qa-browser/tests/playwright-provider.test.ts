import { describe, expect, it } from "vitest";

import type {
  BrowserContextOptions,
  BrowserProviderStartOptions,
} from "../src/host/providers/contract.js";
import { PlaywrightBrowserProvider } from "../src/host/providers/playwright.js";

/**
 * The provider's seams — the module it loads and the process it launches — are
 * the only way to make a launch resolve *after* the stop that was meant to end
 * it, and the only way to see the gate a WebSocket handshake is asked through.
 * So the fakes below keep the shape Playwright needs and record what happened.
 */

interface Gate {
  readonly promise: Promise<void>;
  open: () => void;
}

function gate(): Gate {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  return { promise, open };
}

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

class FakeContext {
  /** The order the provider wired this context, for the routing test. */
  readonly events: string[] = [];
  readonly sockets: FakeSocketRoute[] = [];
  closed = false;
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
    this.closed = true;
  }

  /** The page's `new WebSocket(url)`, as the provider's handler sees it. */
  async dial(url: string): Promise<FakeSocketRoute> {
    const socket = new FakeSocketRoute(url);
    this.sockets.push(socket);
    await this.socketHandler?.(socket);
    return socket;
  }
}

class FakeBrowser {
  closeCalls = 0;
  connected = true;
  readonly contexts: FakeContext[] = [];
  /** Held until a test says the context is finished building. */
  contextGate: Gate | undefined;
  readonly disconnectListeners: (() => void)[] = [];

  once(event: string, listener: () => void): void {
    if (event === "disconnected") this.disconnectListeners.push(listener);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async newContext(): Promise<FakeContext> {
    const context = new FakeContext();
    this.contexts.push(context);
    // The context exists inside Chromium while the gate is shut, but the
    // provider has not been handed it yet — that is the window a stop races.
    await this.contextGate?.promise;
    return context;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.connected = false;
    // A real Chromium announces the closure it was asked for, and a provider
    // that is already stopped must not read that as a crash.
    for (const listener of this.disconnectListeners) listener();
    this.disconnectListeners.length = 0;
  }
}

function createProvider(
  launchGate: (attempt: number) => Promise<void> = async () => undefined,
) {
  const browsers: FakeBrowser[] = [];
  const provider = new PlaywrightBrowserProvider(
    async () =>
      ({
        chromium: {
          // Never consulted: the start options below pin one executable, so
          // every start is exactly one launch attempt this test can gate.
          executablePath: () => "no-such-browser-on-purpose",
          launch: async () => {
            const browser = new FakeBrowser();
            browsers.push(browser);
            await launchGate(browsers.length - 1);
            return browser;
          },
        },
      }) as unknown as typeof import("playwright"),
  );
  return { browsers, provider };
}

const START_OPTIONS = {
  mode: "launch",
  executablePath: process.execPath,
  browserChannel: "chromium",
  cdpEndpoint: null,
  headless: true,
  chromiumSandbox: false,
} satisfies BrowserProviderStartOptions;

function contextOptions(
  overrides: Partial<BrowserContextOptions> = {},
): BrowserContextOptions {
  return {
    sessionId: "session-1",
    viewport: { width: 1_280, height: 720, deviceScaleFactor: 1 },
    actionTimeoutMs: 5_000,
    navigationTimeoutMs: 10_000,
    validateRequest: async () => undefined,
    ...overrides,
  };
}

describe("PlaywrightBrowserProvider network gate", () => {
  it("asks the policy about a WebSocket and refuses the handshake it denies", async () => {
    const asked: { url: string; info: unknown }[] = [];
    const { browsers, provider } = createProvider();
    await provider.start(START_OPTIONS);
    const handle = await provider.createContext(
      contextOptions({
        validateRequest: async (url, info) => {
          asked.push({ url, info });
          throw new Error("BROWSER_HOST_BLOCKED");
        },
      }),
    );

    const socket = await browsers[0]!.contexts[0]!.dial(
      "ws://127.0.0.1:9/auth",
    );

    expect(asked).toEqual([
      { url: "ws://127.0.0.1:9/auth", info: { kind: "resource" } },
    ]);
    // Denied means never dialed: the socket is closed on the page side and the
    // server side is never opened, so the destination sees no handshake.
    expect(socket.connections).toBe(0);
    expect(socket.closures).toHaveLength(1);
    expect(socket.closures[0]?.code).toBe(1008);
    await handle.close();
    await provider.stop();
  });

  it("lets the sockets the policy allows reach their server", async () => {
    const { browsers, provider } = createProvider();
    await provider.start(START_OPTIONS);
    await provider.createContext(contextOptions());

    const socket = await browsers[0]!.contexts[0]!.dial(
      "ws://127.0.0.1:9/auth",
    );

    expect(socket.connections).toBe(1);
    expect(socket.closures).toHaveLength(0);
    await provider.stop();
  });

  it("routes sockets while the context still has no page to dial from", async () => {
    const { browsers, provider } = createProvider();
    await provider.start(START_OPTIONS);
    const handle = await provider.createContext(contextOptions());
    const context = browsers[0]!.contexts[0]!;

    // The registration order is the security property: Playwright only routes
    // sockets created after it, so a route installed alongside the first page
    // would leave that page's own handshakes ungated.
    expect(context.events).toEqual(["route", "route-web-socket"]);
    await handle.newPage();
    expect(context.events).toEqual(["route", "route-web-socket", "new-page"]);
    await provider.stop();
  });
});

describe("PlaywrightBrowserProvider lifecycle", () => {
  it("closes the Chromium whose launch resolves after the stop began", async () => {
    const late = gate();
    const { browsers, provider } = createProvider(async (attempt) => {
      if (attempt === 0) await late.promise;
    });
    const crashes: Error[] = [];
    provider.onCrash((error) => crashes.push(error));

    const starting = provider.start(START_OPTIONS);
    const stopping = provider.stop();
    late.open();
    await starting;
    await stopping;

    const browser = browsers[0]!;
    expect(browser.closeCalls).toBe(1);
    expect(crashes).toHaveLength(0);
    await expect(
      provider.createContext(contextOptions()),
    ).rejects.toMatchObject({ code: "BROWSER_START_FAILED" });
  });

  it("closes the context whose build finishes after the stop began", async () => {
    const { browsers, provider } = createProvider();
    await provider.start(START_OPTIONS);
    const browser = browsers[0]!;
    const late = gate();
    browser.contextGate = late;

    const creating = provider.createContext(contextOptions());
    const stopping = provider.stop();
    late.open();
    const handle = await creating;
    await stopping;

    expect(browser.contexts[0]?.closed).toBe(true);
    // A handle the stop already consumed is a closed one, not a live page.
    await expect(handle.newPage()).rejects.toMatchObject({
      code: "BROWSER_CONTEXT_CLOSED",
    });
  });

  it("launches afresh for a start that waited behind the stop", async () => {
    const late = gate();
    const { browsers, provider } = createProvider(async (attempt) => {
      if (attempt === 0) await late.promise;
    });

    const starting = provider.start(START_OPTIONS);
    late.open();
    await starting;
    const first = browsers[0]!;
    await provider.stop();
    await provider.start(START_OPTIONS);

    expect(first.closeCalls).toBe(1);
    expect(browsers[1]).toBeDefined();
    expect(browsers[1]?.connected).toBe(true);
    await provider.createContext(contextOptions());
    expect(browsers[1]?.contexts).toHaveLength(1);
    await provider.stop();
  });

  it("refuses a new context while the stop is still running", async () => {
    const { browsers, provider } = createProvider();
    await provider.start(START_OPTIONS);
    const browser = browsers[0]!;
    const late = gate();
    browser.contextGate = late;
    const creating = provider.createContext(contextOptions());
    const stopping = provider.stop();

    // The build already in flight is waited for; one that has not started is
    // turned away, because the provider it would be listed in is closing.
    await expect(
      provider.createContext(contextOptions()),
    ).rejects.toMatchObject({ code: "BROWSER_START_FAILED" });

    late.open();
    await creating;
    await stopping;
    expect(browser.contexts[0]?.closed).toBe(true);
    expect(browser.closeCalls).toBe(1);
  });
});
