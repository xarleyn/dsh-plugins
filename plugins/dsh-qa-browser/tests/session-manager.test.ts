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
  BrowserSnapshotMode,
  BrowserWaitRequest,
  BrowserViewport,
  LocatorPlan,
} from "../src/types.js";

class FakePage implements BrowserPageHandle {
  currentUrl = "about:blank";
  currentTitle = "";
  closed = false;
  activeNavigations = 0;
  maxActiveNavigations = 0;
  readonly navigations: string[] = [];
  readonly pointerActions: Array<{
    readonly action: "move" | "click" | "down" | "up";
    readonly x: number;
    readonly y: number;
  }> = [];
  readonly insertedText: string[] = [];
  readonly wheels: Array<readonly [number, number]> = [];
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

  async snapshot(_mode: BrowserSnapshotMode) {
    return [
      {
        role: "textbox",
        name: "Email",
        locator: { type: "label", label: "Email", exact: true } as const,
        fingerprint: { role: "textbox", name: "Email", label: "Email" },
        interactive: true,
      },
      {
        role: "button",
        name: "Continue",
        locator: {
          type: "role",
          role: "button",
          name: "Continue",
          exact: true,
        } as const,
        fingerprint: { role: "button", name: "Continue" },
        interactive: true,
      },
    ];
  }

  async validateLocator(_locator: LocatorPlan): Promise<void> {}

  async click(_locator: LocatorPlan): Promise<void> {}

  async type(
    _locator: LocatorPlan,
    _text: string,
    _options?: { readonly clear?: boolean; readonly submit?: boolean },
  ): Promise<void> {}

  async setValue(_locator: LocatorPlan): Promise<void> {}

  async press(_key: string): Promise<void> {}

  async insertText(text: string): Promise<void> {
    this.insertedText.push(text);
  }

  async pointer(request: {
    readonly action: "move" | "click" | "down" | "up";
    readonly x: number;
    readonly y: number;
  }): Promise<void> {
    this.pointerActions.push(request);
  }

  async wheel(deltaX: number, deltaY: number): Promise<void> {
    this.wheels.push([deltaX, deltaY]);
  }

  async hover(_locator: LocatorPlan): Promise<void> {}

  async scroll(_deltaY: number, _locator?: LocatorPlan): Promise<void> {}

  async wait(
    _request: Omit<BrowserWaitRequest, "ref"> & {
      readonly locator?: LocatorPlan;
    },
  ): Promise<void> {}

  async history(action: "back" | "forward" | "reload") {
    this.currentTitle = action;
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

  it("binds semantic refs to a revision and refuses stale actions", async () => {
    const { manager } = createHarness();
    const session = await manager.ensureSession("semantic");
    const tabId = session.selectedTabId!;
    const snapshot = await manager.snapshot("semantic", tabId);
    expect(snapshot.text).toContain('[e1] textbox "Email"');
    await expect(
      manager.type("semantic", tabId, "e1", "secret"),
    ).resolves.toMatchObject({
      ok: true,
    });
    await expect(manager.click("semantic", tabId, "e2")).rejects.toMatchObject({
      code: "BROWSER_STALE_REF",
    });
    await manager.dispose();
  });

  it("leases human control, blocks agent mutations, and expires safely", async () => {
    let now = 10_000;
    const { config, manager, provider } = createHarness({ now: () => now });
    const session = await manager.ensureSession("takeover");
    const tabId = session.selectedTabId!;

    expect(manager.acquireHumanControl("takeover", "client-a").control).toEqual(
      {
        owner: "human",
        clientId: "client-a",
        leaseExpiresAt: now + config.humanControl.leaseMs,
      },
    );
    await expect(
      manager.navigate("takeover", tabId, { url: "https://one.example" }),
    ).rejects.toMatchObject({ code: "BROWSER_HUMAN_CONTROL_ACTIVE" });
    await expect(manager.snapshot("takeover", tabId)).resolves.toMatchObject({
      tabId,
    });
    await expect(manager.screenshot("takeover", tabId)).resolves.toEqual(
      Buffer.from("fake-png"),
    );
    await expect(
      manager.humanPointer("takeover", tabId, "client-a", {
        action: "click",
        x: 720,
        y: 450,
      }),
    ).resolves.toMatchObject({ ok: true });
    const page = [...provider.contexts.values()][0]!.pages[0]!;
    expect(page.pointerActions).toEqual([{ action: "click", x: 720, y: 450 }]);

    now += config.humanControl.leaseMs - 1;
    expect(
      manager.heartbeatHumanControl("takeover", "client-a").control,
    ).toMatchObject({ leaseExpiresAt: now + config.humanControl.leaseMs });
    await expect(
      manager.humanPointer("takeover", tabId, "client-a", {
        action: "click",
        x: 1440,
        y: 0,
      }),
    ).rejects.toMatchObject({ code: "BROWSER_ACTION_FAILED" });

    now += config.humanControl.leaseMs;
    expect(manager.getSession("takeover")?.control).toEqual({
      owner: "agent",
      leaseExpiresAt: null,
    });
    await expect(
      manager.navigate("takeover", tabId, { url: "https://two.example" }),
    ).resolves.toMatchObject({ ok: true });
    await manager.dispose();
  });

  it("rejects competing human clients and releases only for the owner", async () => {
    const { manager } = createHarness();
    await manager.ensureSession("owners");
    manager.acquireHumanControl("owners", "client-a");
    expect(() =>
      manager.acquireHumanControl("owners", "client-b"),
    ).toThrowError(
      expect.objectContaining({ code: "BROWSER_HUMAN_CONTROL_ACTIVE" }),
    );
    expect(() =>
      manager.releaseHumanControl("owners", "client-b"),
    ).toThrowError(
      expect.objectContaining({ code: "BROWSER_HUMAN_CONTROL_NOT_OWNER" }),
    );
    expect(manager.releaseHumanControl("owners", "client-a").control).toEqual({
      owner: "agent",
      leaseExpiresAt: null,
    });
    await manager.dispose();
  });
});
