import { Context, Service } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";

import {
  QaBrowserConfigSchema,
  resolveQaBrowserConfig,
  type QaBrowserConfig,
  type ResolvedQaBrowserConfig,
} from "../config.js";
import type {
  BrowserActionResult,
  BrowserNavigationRequest,
  BrowserSessionInfo,
  BrowserTabInfo,
  BrowserViewport,
} from "../types.js";
import { BrowserNetworkPolicy } from "./policy.js";
import type { BrowserProvider } from "./providers/contract.js";
import { PlaywrightBrowserProvider } from "./providers/playwright.js";
import {
  QaBrowserSessionManager,
  type BrowserRuntimeLogger,
} from "./session-manager.js";

export interface QaBrowserServiceDependencies {
  readonly provider?: BrowserProvider;
  readonly logger?: BrowserRuntimeLogger;
  readonly dshOrigins?: readonly string[];
  readonly now?: () => number;
  readonly startIdleTimer?: boolean;
}

/** Public Host service. Browser state is keyed only by DSH session id. */
export class QaBrowserService extends Service {
  static inject = ["agents"];
  static Config = QaBrowserConfigSchema;

  readonly config: ResolvedQaBrowserConfig;
  private readonly manager: QaBrowserSessionManager;
  private readonly logger: BrowserRuntimeLogger & { close?(): Promise<void> };
  private disposePromise: Promise<void> | undefined;

  constructor(
    ctx: Context,
    config: QaBrowserConfig = {},
    dependencies: QaBrowserServiceDependencies = {},
  ) {
    super(ctx, "qaBrowser");
    this.config = resolveQaBrowserConfig(config);
    this.logger =
      dependencies.logger ??
      (getPluginLogger({
        pluginId: "dsh-qa-browser",
        consoleSink: createHostLoggerSink(ctx.logger),
      }) as PluginLogger & BrowserRuntimeLogger);
    const provider = dependencies.provider ?? new PlaywrightBrowserProvider();
    this.manager = new QaBrowserSessionManager({
      config: this.config,
      provider,
      policy: new BrowserNetworkPolicy(this.config.security.network, {
        dshOrigins: dependencies.dshOrigins,
      }),
      logger: this.logger,
      now: dependencies.now,
      startIdleTimer: dependencies.startIdleTimer,
    });

    ctx.on(
      "agent/disposed",
      ({ agent }) => {
        void this.manager
          .closeSession(String(agent.session.id))
          .catch((error: unknown) => {
            this.logger.warn("browser.session-dispose-failed", {
              sessionId: String(agent.session.id),
              error: error instanceof Error ? error.message : String(error),
            });
          });
      },
      { global: true },
    );
    ctx.effect(() => () => void this.dispose(), "dsh-qa-browser.lifecycle");
    this.logger.info("browser.plugin-ready", {
      enabled: this.config.enabled,
      provider: this.config.runtime.provider,
      headless: this.config.runtime.headless,
    });
  }

  ensureSession(sessionId: string): Promise<BrowserSessionInfo> {
    return this.manager.ensureSession(sessionId);
  }

  getSession(sessionId: string): BrowserSessionInfo | null {
    return this.manager.getSession(sessionId);
  }

  closeSession(sessionId: string): Promise<void> {
    return this.manager.closeSession(sessionId);
  }

  listTabs(sessionId: string): Promise<readonly BrowserTabInfo[]> {
    return this.manager.listTabs(sessionId);
  }

  newTab(sessionId: string): Promise<BrowserTabInfo> {
    return this.manager.newTab(sessionId);
  }

  closeTab(sessionId: string, tabId: string): Promise<void> {
    return this.manager.closeTab(sessionId, tabId);
  }

  selectTab(sessionId: string, tabId: string): Promise<void> {
    return this.manager.selectTab(sessionId, tabId);
  }

  navigate(
    sessionId: string,
    tabId: string,
    request: BrowserNavigationRequest,
  ): Promise<BrowserActionResult> {
    return this.manager.navigate(sessionId, tabId, request);
  }

  setViewport(
    sessionId: string,
    tabId: string,
    viewport: BrowserViewport,
  ): Promise<void> {
    return this.manager.setViewport(sessionId, tabId, viewport);
  }

  /** Phase-1 host primitive; Phase 4 will wrap it in native DSH artifacts. */
  screenshot(sessionId: string, tabId: string): Promise<Buffer> {
    return this.manager.screenshot(sessionId, tabId);
  }

  dispose(): Promise<void> {
    this.disposePromise ??= this.manager
      .dispose()
      .finally(() => this.logger.close?.());
    return this.disposePromise;
  }
}
