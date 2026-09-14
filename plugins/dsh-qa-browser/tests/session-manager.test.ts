import { describe, expect, it } from "vitest";

import { resolveQaBrowserConfig } from "../src/config.js";
import { QaBrowserError } from "../src/errors.js";
import { BrowserNetworkPolicy } from "../src/host/policy.js";
import type {
  BrowserContextHandle,
  BrowserContextOptions,
  BrowserPageHandle,
  BrowserProvider,
  BrowserProviderStartOptions,
} from "../src/host/providers/contract.js";
import { QaBrowserSessionManager } from "../src/host/session-manager.js";
import type {
  BrowserNavigationRequest,
  BrowserViewport,
} from "../src/types.js";

class FakePage implements BrowserPageHandle {
  currentUrl = "about:blank";
  currentTitle = "";
  closed = false;
  activeNavigations = 0;
  maxActiveNavigations = 0;
  readonly navigations: string[] = [];
  private readonly changed = new Set<() => void>();
  private readonly closedListeners = new Set<() => void>();

  url(): string {
    return this.currentUrl;
  }

  async title(): Promise<string> {
    return this.currentTitle;
  }

  async navigate(request: BrowserNavigationRequest) {
    this.activeNavigations += 1;
    this.maxActiveNavigations = Math.max(
      this.maxActiveNavigations,
      this.activeNavigations,
    );
    this.navigations.push(request.url);
    await Promise.resolve();
    this.currentUrl = request.url;
    this.currentTitle = new URL(request.url).hostname;
    this.activeNavigations -= 1;
    for (const listener of this.changed) listener();
    return { url: this.currentUrl, title: this.currentTitle };
  }

  async setViewport(_viewport: BrowserViewport): Promise<void> {}

  async screenshot(): Promise<Buffer> {
    return Buffer.from("fake-png");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closedListeners) listener();
  }

  onChanged(listener: () => void): () => void {
    this.changed.add(listener);
    return () => this.changed.delete(listener);
  }

  onClosed(listener: () => void): () => void {
    this.closedListeners.add(listener);
    return () => this.closedListeners.delete(listener);
  }
}

class FakeContext implements BrowserContextHandle {
  readonly pages: FakePage[] = [];
  closed = false;

  constructor(
    readonly id: string,
    readonly sessionId: string,
  ) {}

  async newPage(): Promise<FakePage> {
    const page = new FakePage();
    this.pages.push(page);
    return page;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.pages.map((page) => page.close()));
  }
}

class FakeProvider implements BrowserProvider {
  starts = 0;
  stops = 0;
  readonly contexts = new Map<string, FakeContext>();
  private readonly crashListeners = new Set<(error: Error) => void>();

  async start(_options: BrowserProviderStartOptions): Promise<void> {
    this.starts += 1;
  }

  async stop(): Promise<void> {
    this.stops += 1;
  }

  async createContext(options: BrowserContextOptions): Promise<FakeContext> {
    const context = new FakeContext(
      `context_${this.contexts.size + 1}`,
      options.sessionId,
    );
    this.contexts.set(context.id, context);
    return context;
  }

  async closeContext(id: string): Promise<void> {
    const context = this.contexts.get(id);
    if (context === undefined) return;
    await context.close();
    this.contexts.delete(id);
  }

  onCrash(listener: (error: Error) => void): () => void {
    this.crashListeners.add(listener);
    return () => this.crashListeners.delete(listener);
  }

  crash(): void {
    for (const listener of this.crashListeners) listener(new Error("boom"));
  }
}

function createHarness(options: { now?: () => number; maxTabs?: number } = {}) {
  const provider = new FakeProvider();
  const config = resolveQaBrowserConfig({
    session: { maxTabs: options.maxTabs },
    security: { network: { allowHosts: ["*.example"] } },
  });
  const manager = new QaBrowserSessionManager({
    config,
    provider,
    policy: new BrowserNetworkPolicy(config.security.network, {
      lookup: (async () => [{ address: "203.0.113.10", family: 4 }]) as never,
    }),
    now: options.now,
    startIdleTimer: false,
  });
  return { config, manager, provider };
}

describe("QaBrowserSessionManager", () => {
  it("creates one isolated context per DSH session and keeps independent tabs", async () => {
    const { manager, provider } = createHarness();
    const [left, right] = await Promise.all([
      manager.ensureSession("session-a"),
      manager.ensureSession("session-b"),
    ]);
    expect(provider.contexts.size).toBe(2);
    expect(left.tabIds).toHaveLength(1);
    expect(right.tabIds).toHaveLength(1);
    expect(left.tabIds[0]).not.toBe(right.tabIds[0]);

    await manager.newTab("session-a");
    expect(await manager.listTabs("session-a")).toHaveLength(2);
    expect(await manager.listTabs("session-b")).toHaveLength(1);
    await manager.dispose();
  });

  it("coalesces concurrent creation and serializes mutations on one tab", async () => {
    const { manager, provider } = createHarness();
    const sessions = await Promise.all([
      manager.ensureSession("same"),
      manager.ensureSession("same"),
      manager.ensureSession("same"),
    ]);
    expect(provider.contexts.size).toBe(1);
    const tabId = sessions[0]?.selectedTabId;
    expect(tabId).toBeTruthy();
    await Promise.all([
      manager.navigate("same", tabId!, { url: "https://one.example" }),
      manager.navigate("same", tabId!, { url: "https://two.example" }),
    ]);
    const page = [...provider.contexts.values()][0]?.pages[0];
    expect(page?.navigations).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
    expect(page?.maxActiveNavigations).toBe(1);
    await manager.dispose();
  });

  it("enforces tab limits and closes idle contexts", async () => {
    let now = 1_000;
    const { config, manager, provider } = createHarness({
      now: () => now,
      maxTabs: 1,
    });
    await manager.ensureSession("idle");
    await expect(manager.newTab("idle")).rejects.toMatchObject({
      code: "BROWSER_TOO_MANY_TABS",
    } satisfies Partial<QaBrowserError>);
    now += config.runtime.idleTimeoutMs;
    await expect(manager.closeIdleSessions()).resolves.toBe(1);
    expect(manager.getSession("idle")).toBeNull();
    expect(provider.contexts.size).toBe(0);
    await manager.dispose();
  });

  it("marks state lost on crash and recreates the context on the next ensure", async () => {
    const { manager, provider } = createHarness();
    await manager.ensureSession("crash");
    provider.crash();
    expect(manager.getSession("crash")).toMatchObject({
      status: "crashed",
      selectedTabId: null,
      tabIds: [],
    });
    await manager.ensureSession("crash");
    expect(manager.getSession("crash")?.status).toBe("ready");
    await manager.dispose();
  });
});
