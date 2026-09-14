import { randomUUID } from "node:crypto";

import type { ResolvedQaBrowserConfig } from "../config.js";
import {
  browserErrorMessage,
  QaBrowserError,
  type QaBrowserErrorCode,
} from "../errors.js";
import type {
  BrowserActionResult,
  BrowserNavigationRequest,
  BrowserSessionInfo,
  BrowserTabInfo,
  BrowserViewport,
} from "../types.js";
import type {
  BrowserContextHandle,
  BrowserPageHandle,
  BrowserProvider,
} from "./providers/contract.js";
import type { BrowserNetworkPolicy } from "./policy.js";

export interface BrowserRuntimeLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export const silentBrowserLogger: BrowserRuntimeLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface TabRecord {
  readonly id: string;
  readonly page: BrowserPageHandle;
  readonly viewport: BrowserViewport;
  url: string;
  title: string;
  status: BrowserTabInfo["status"];
  revision: number;
  queue: Promise<void>;
  disposers: (() => void)[];
}

interface SessionRecord {
  readonly sessionId: string;
  readonly context: BrowserContextHandle;
  readonly tabs: Map<string, TabRecord>;
  status: BrowserSessionInfo["status"];
  selectedTabId: string | null;
  readonly createdAt: number;
  lastActivityAt: number;
  activeActions: number;
}

export interface QaBrowserSessionManagerOptions {
  readonly config: ResolvedQaBrowserConfig;
  readonly provider: BrowserProvider;
  readonly policy: BrowserNetworkPolicy;
  readonly logger?: BrowserRuntimeLogger;
  readonly now?: () => number;
  readonly startIdleTimer?: boolean;
}

function tabId(): string {
  return `tab_${randomUUID().replaceAll("-", "")}`;
}

/** Owns isolated contexts, stable tab ids, per-tab mutation queues and cleanup. */
export class QaBrowserSessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly creating = new Map<string, Promise<SessionRecord>>();
  private readonly logger: BrowserRuntimeLogger;
  private readonly now: () => number;
  private readonly crashDisposer: () => void;
  private readonly idleTimer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private readonly options: QaBrowserSessionManagerOptions) {
    this.logger = options.logger ?? silentBrowserLogger;
    this.now = options.now ?? Date.now;
    this.crashDisposer = options.provider.onCrash((error) =>
      this.handleProviderCrash(error),
    );
    if (options.startIdleTimer === false) {
      this.idleTimer = undefined;
    } else {
      const interval = Math.min(
        60_000,
        Math.max(1_000, options.config.runtime.idleTimeoutMs / 2),
      );
      this.idleTimer = setInterval(() => {
        void this.closeIdleSessions().catch((error: unknown) => {
          this.logger.warn("browser.idle-cleanup-failed", {
            error: browserErrorMessage(error),
          });
        });
      }, interval);
      this.idleTimer.unref?.();
    }
  }

  async ensureSession(sessionId: string): Promise<BrowserSessionInfo> {
    this.assertAvailable();
    const id = this.validSessionId(sessionId);
    const existing = this.sessions.get(id);
    if (existing !== undefined && existing.status !== "crashed") {
      this.touch(existing);
      return this.sessionInfo(existing);
    }
    if (existing?.status === "crashed") this.sessions.delete(id);

    let pending = this.creating.get(id);
    if (pending === undefined) {
      pending = this.createSession(id);
      this.creating.set(id, pending);
    }
    try {
      return this.sessionInfo(await pending);
    } finally {
      if (this.creating.get(id) === pending) this.creating.delete(id);
    }
  }

  getSession(sessionId: string): BrowserSessionInfo | null {
    const record = this.sessions.get(sessionId);
    return record === undefined ? null : this.sessionInfo(record);
  }

  async closeSession(sessionId: string): Promise<void> {
    const pending = this.creating.get(sessionId);
    if (pending !== undefined) await pending.catch(() => undefined);
    const record = this.sessions.get(sessionId);
    if (record === undefined) return;
    this.sessions.delete(sessionId);
    record.status = "closed";
    for (const tab of record.tabs.values()) this.disposeTabListeners(tab);
    record.tabs.clear();
    record.selectedTabId = null;
    await this.options.provider.closeContext(record.context.id);
    this.logger.info("browser.session-closed", { sessionId });
  }

  async listTabs(sessionId: string): Promise<readonly BrowserTabInfo[]> {
    const record = this.requireSession(sessionId);
    await Promise.all(
      [...record.tabs.values()].map((tab) => this.refreshTab(tab, false)),
    );
    this.touch(record);
    return [...record.tabs.values()].map((tab) => this.tabInfo(tab));
  }

  async newTab(sessionId: string): Promise<BrowserTabInfo> {
    await this.ensureSession(sessionId);
    const record = this.requireSession(sessionId);
    if (record.tabs.size >= this.options.config.session.maxTabs) {
      throw new QaBrowserError(
        "BROWSER_TOO_MANY_TABS",
        `Browser session reached its ${this.options.config.session.maxTabs}-tab limit.`,
      );
    }
    const tab = await this.createTab(record);
    record.selectedTabId = tab.id;
    this.touch(record);
    return this.tabInfo(tab);
  }

  async closeTab(sessionId: string, id: string): Promise<void> {
    const record = this.requireSession(sessionId);
    const tab = this.requireTab(record, id);
    await tab.queue;
    this.disposeTabListeners(tab);
    tab.status = "closed";
    record.tabs.delete(id);
    if (record.selectedTabId === id) {
      record.selectedTabId = record.tabs.keys().next().value ?? null;
    }
    await tab.page.close();
    this.touch(record);
  }

  async selectTab(sessionId: string, id: string): Promise<void> {
    const record = this.requireSession(sessionId);
    this.requireTab(record, id);
    record.selectedTabId = id;
    this.touch(record);
  }

  async navigate(
    sessionId: string,
    id: string,
    request: BrowserNavigationRequest,
  ): Promise<BrowserActionResult> {
    const record = this.requireSession(sessionId);
    const tab = this.requireTab(record, id);
    return this.enqueue(record, tab, async () => {
      const started = this.now();
      const from = tab.page.url();
      await this.options.policy.assertAllowed(request.url);
      tab.status = "loading";
      try {
        const result = await tab.page.navigate(request);
        tab.url = result.url;
        tab.title = result.title;
        tab.status = "ready";
        tab.revision += 1;
        await this.options.policy.assertAllowed(result.url);
        this.logger.debug("browser.action", {
          sessionId,
          tabId: id,
          action: "navigate",
          durationMs: this.now() - started,
          urlHost: new URL(result.url).host,
          revision: tab.revision,
        });
        return {
          ok: true,
          sessionId,
          tabId: id,
          revision: tab.revision,
          url: tab.url,
          title: tab.title,
          summary: "Navigation completed.",
          navigation: { from, to: tab.url },
        };
      } catch (error) {
        tab.status = "failed";
        this.logger.warn("browser.action-failed", {
          sessionId,
          tabId: id,
          action: "navigate",
          durationMs: this.now() - started,
          errorCode:
            error instanceof QaBrowserError
              ? error.code
              : "BROWSER_ACTION_FAILED",
        });
        if (error instanceof QaBrowserError) throw error;
        const code: QaBrowserErrorCode =
          error instanceof Error && /timeout/iu.test(error.message)
            ? "BROWSER_TIMEOUT"
            : "BROWSER_ACTION_FAILED";
        throw new QaBrowserError(code, "Browser navigation failed.", {
          cause: error,
        });
      }
    });
  }

  async setViewport(
    sessionId: string,
    id: string,
    viewport: BrowserViewport,
  ): Promise<void> {
    const record = this.requireSession(sessionId);
    const tab = this.requireTab(record, id);
    await this.enqueue(record, tab, async () => {
      await tab.page.setViewport(viewport);
      Object.assign(tab.viewport, viewport);
      tab.revision += 1;
    });
  }

  async screenshot(sessionId: string, id: string): Promise<Buffer> {
    const record = this.requireSession(sessionId);
    const tab = this.requireTab(record, id);
    const image = await tab.page.screenshot();
    this.touch(record);
    return image;
  }

  async closeIdleSessions(now = this.now()): Promise<number> {
    const expired = [...this.sessions.values()].filter(
      (record) =>
        record.activeActions === 0 &&
        now - record.lastActivityAt >=
          this.options.config.runtime.idleTimeoutMs,
    );
    await Promise.all(
      expired.map((record) => this.closeSession(record.sessionId)),
    );
    if (expired.length > 0) {
      this.logger.info("browser.contexts-evicted", { count: expired.length });
    }
    return expired.length;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.idleTimer !== undefined) clearInterval(this.idleTimer);
    this.crashDisposer();
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(
      ids.map((sessionId) => this.closeSession(sessionId)),
    );
    await this.options.provider.stop();
  }

  private async createSession(sessionId: string): Promise<SessionRecord> {
    await this.options.provider.start(this.options.config.runtime);
    const now = this.now();
    const context = await this.options.provider.createContext({
      sessionId,
      viewport: this.options.config.viewport,
      actionTimeoutMs: this.options.config.runtime.actionTimeoutMs,
      navigationTimeoutMs: this.options.config.runtime.navigationTimeoutMs,
      validateRequest: async (url) => {
        await this.options.policy.assertAllowed(url);
      },
    });
    const record: SessionRecord = {
      sessionId,
      context,
      tabs: new Map(),
      status: "starting",
      selectedTabId: null,
      createdAt: now,
      lastActivityAt: now,
      activeActions: 0,
    };
    try {
      const tab = await this.createTab(record);
      record.selectedTabId = tab.id;
      record.status = "ready";
      this.sessions.set(sessionId, record);
      this.logger.info("browser.session-created", {
        sessionId,
        contextId: context.id,
      });
      return record;
    } catch (error) {
      await this.options.provider
        .closeContext(context.id)
        .catch(() => undefined);
      throw error;
    }
  }

  private async createTab(record: SessionRecord): Promise<TabRecord> {
    const page = await record.context.newPage();
    const tab: TabRecord = {
      id: tabId(),
      page,
      viewport: { ...this.options.config.viewport },
      url: page.url(),
      title: await page.title(),
      status: "ready",
      revision: 0,
      queue: Promise.resolve(),
      disposers: [],
    };
    tab.disposers.push(
      page.onChanged(() => {
        void this.refreshTab(tab, true);
      }),
      page.onClosed(() => this.onPageClosed(record, tab)),
    );
    record.tabs.set(tab.id, tab);
    return tab;
  }

  private onPageClosed(record: SessionRecord, tab: TabRecord): void {
    if (record.tabs.get(tab.id) !== tab) return;
    this.disposeTabListeners(tab);
    tab.status = "closed";
    record.tabs.delete(tab.id);
    if (record.selectedTabId === tab.id) {
      record.selectedTabId = record.tabs.keys().next().value ?? null;
    }
  }

  private async refreshTab(
    tab: TabRecord,
    advanceRevision: boolean,
  ): Promise<void> {
    if (tab.status === "closed") return;
    try {
      tab.url = tab.page.url();
      tab.title = await tab.page.title();
      if (advanceRevision) tab.revision += 1;
      if (tab.status === "loading") tab.status = "ready";
    } catch {
      // A simultaneous close owns the final state.
    }
  }

  private enqueue<T>(
    record: SessionRecord,
    tab: TabRecord,
    action: () => Promise<T>,
  ): Promise<T> {
    const run = tab.queue.then(async () => {
      if (tab.status === "closed") {
        throw new QaBrowserError(
          "BROWSER_TAB_CLOSED",
          "Browser tab is closed.",
        );
      }
      record.activeActions += 1;
      this.touch(record);
      try {
        return await action();
      } finally {
        record.activeActions -= 1;
        this.touch(record);
      }
    });
    tab.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private handleProviderCrash(error: Error): void {
    for (const record of this.sessions.values()) {
      record.status = "crashed";
      record.selectedTabId = null;
      for (const tab of record.tabs.values()) {
        this.disposeTabListeners(tab);
        tab.status = "closed";
      }
      record.tabs.clear();
    }
    this.logger.error("browser.crashed", { error: error.message });
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (record === undefined) {
      throw new QaBrowserError(
        "BROWSER_SESSION_NOT_FOUND",
        "Browser session has not been started.",
      );
    }
    if (record.status === "crashed") {
      throw new QaBrowserError(
        "BROWSER_CRASHED",
        "Browser page state was lost after a crash.",
      );
    }
    return record;
  }

  private requireTab(record: SessionRecord, id: string): TabRecord {
    const tab = record.tabs.get(id);
    if (tab === undefined) {
      throw new QaBrowserError(
        "BROWSER_TAB_NOT_FOUND",
        "Browser tab was not found.",
      );
    }
    return tab;
  }

  private assertAvailable(): void {
    if (this.disposed) {
      throw new QaBrowserError(
        "BROWSER_CONTEXT_CLOSED",
        "Browser runtime is closed.",
      );
    }
    if (!this.options.config.enabled) {
      throw new QaBrowserError(
        "BROWSER_DISABLED",
        "Browser runtime is disabled.",
      );
    }
  }

  private validSessionId(sessionId: string): string {
    const value = sessionId.trim();
    if (value === "") {
      throw new QaBrowserError(
        "BROWSER_SESSION_NOT_FOUND",
        "DSH session id must not be empty.",
      );
    }
    return value;
  }

  private touch(record: SessionRecord): void {
    record.lastActivityAt = this.now();
    if (record.status === "idle") record.status = "ready";
  }

  private sessionInfo(record: SessionRecord): BrowserSessionInfo {
    return {
      sessionId: record.sessionId,
      status: record.status,
      selectedTabId: record.selectedTabId,
      tabIds: [...record.tabs.keys()],
      control: { owner: "agent", leaseExpiresAt: null },
      profileName: null,
      createdAt: record.createdAt,
      lastActivityAt: record.lastActivityAt,
    };
  }

  private tabInfo(tab: TabRecord): BrowserTabInfo {
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      status: tab.status,
      revision: tab.revision,
      viewport: { ...tab.viewport },
    };
  }

  private disposeTabListeners(tab: TabRecord): void {
    for (const dispose of tab.disposers.splice(0).reverse()) dispose();
  }
}
