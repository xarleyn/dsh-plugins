import { resolveQaBrowserConfig } from "../src/config.js";
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

export class FakePage implements BrowserPageHandle {
  currentUrl = "about:blank";
  currentTitle = "";
  closed = false;
  activeNavigations = 0;
  maxActiveNavigations = 0;
  readonly navigations: string[] = [];
  readonly viewports: BrowserViewport[] = [];
  /** A browser-like history: what the tab visited, and where it stands now. */
  readonly historyEntries: string[] = ["about:blank"];
  historyIndex = 0;
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
    this.recordEntry(request.url);
    this.activeNavigations -= 1;
    for (const listener of this.changed) listener();
    return { url: this.currentUrl, title: this.currentTitle };
  }

  /** A page that moved without anyone asking: a link, a form post, a redirect. */
  followLink(url: string): void {
    this.currentUrl = url;
    this.currentTitle = new URL(url).hostname;
    this.recordEntry(url);
    for (const listener of this.changed) listener();
  }

  private recordEntry(url: string): void {
    this.historyEntries.splice(this.historyIndex + 1);
    this.historyEntries.push(url);
    this.historyIndex = this.historyEntries.length - 1;
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
    if (action === "back" && this.historyIndex > 0) {
      this.historyIndex -= 1;
      this.currentUrl =
        this.historyEntries[this.historyIndex] ?? this.currentUrl;
    } else if (
      action === "forward" &&
      this.historyIndex < this.historyEntries.length - 1
    ) {
      this.historyIndex += 1;
      this.currentUrl =
        this.historyEntries[this.historyIndex] ?? this.currentUrl;
    }
    this.currentTitle = action;
    return { url: this.currentUrl, title: this.currentTitle };
  }

  async setViewport(viewport: BrowserViewport): Promise<void> {
    this.viewports.push(viewport);
  }

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

export class FakeContext implements BrowserContextHandle {
  readonly pages: FakePage[] = [];
  closed = false;
  options?: BrowserContextOptions;

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

export class FakeProvider implements BrowserProvider {
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
    context.options = options;
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

export function createHarness(
  options: { now?: () => number; maxTabs?: number } = {},
) {
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
