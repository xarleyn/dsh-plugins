import { Context, Service } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-tools";
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
  BrowserFormValue,
  BrowserNavigationRequest,
  BrowserSessionInfo,
  BrowserSnapshot,
  BrowserSnapshotOptions,
  BrowserTabInfo,
  BrowserViewport,
  BrowserWaitRequest,
} from "../types.js";
import { BrowserNetworkPolicy } from "./policy.js";
import type { BrowserProvider } from "./providers/contract.js";
import { PlaywrightBrowserProvider } from "./providers/playwright.js";
import {
  QaBrowserSessionManager,
  type BrowserRuntimeLogger,
} from "./session-manager.js";
import { createBrowserCoreTools } from "./tools/index.js";

export interface QaBrowserServiceDependencies {
  readonly provider?: BrowserProvider;
  readonly logger?: BrowserRuntimeLogger;
  readonly dshOrigins?: readonly string[];
  readonly now?: () => number;
  readonly startIdleTimer?: boolean;
}

/** Public Host service. Browser state is keyed only by DSH session id. */
export class QaBrowserService extends Service {
  static inject = ["agents", "tools"];
  static Config = QaBrowserConfigSchema;

  readonly config: ResolvedQaBrowserConfig;
  private readonly manager: QaBrowserSessionManager;
  private readonly logger: BrowserRuntimeLogger & { close?(): Promise<void> };
  private readonly toolDisposers: (() => void)[] = [];
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
    if (this.config.enabled && this.config.capabilities.core) {
      for (const definition of createBrowserCoreTools(this)) {
        this.toolDisposers.push(ctx.tools.register(definition));
      }
    }

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

  snapshot(
    sessionId: string,
    tabId: string,
    options?: BrowserSnapshotOptions,
  ): Promise<BrowserSnapshot> {
    return this.manager.snapshot(sessionId, tabId, options);
  }

  click(
    sessionId: string,
    tabId: string,
    ref: string,
    options?: {
      readonly button?: "left" | "middle" | "right";
      readonly clickCount?: 1 | 2;
    },
  ): Promise<BrowserActionResult> {
    return this.manager.click(sessionId, tabId, ref, options);
  }

  type(
    sessionId: string,
    tabId: string,
    ref: string,
    text: string,
    options?: { readonly clear?: boolean; readonly submit?: boolean },
  ): Promise<BrowserActionResult> {
    return this.manager.type(sessionId, tabId, ref, text, options);
  }

  fillForm(
    sessionId: string,
    tabId: string,
    fields: readonly {
      readonly ref: string;
      readonly value: BrowserFormValue;
    }[],
  ): Promise<BrowserActionResult> {
    return this.manager.fillForm(sessionId, tabId, fields);
  }

  select(
    sessionId: string,
    tabId: string,
    ref: string,
    value: BrowserFormValue,
  ): Promise<BrowserActionResult> {
    return this.manager.select(sessionId, tabId, ref, value);
  }

  press(
    sessionId: string,
    tabId: string,
    key: string,
  ): Promise<BrowserActionResult> {
    return this.manager.press(sessionId, tabId, key);
  }

  hover(
    sessionId: string,
    tabId: string,
    ref: string,
  ): Promise<BrowserActionResult> {
    return this.manager.hover(sessionId, tabId, ref);
  }

  scroll(
    sessionId: string,
    tabId: string,
    deltaY: number,
    ref?: string,
  ): Promise<BrowserActionResult> {
    return this.manager.scroll(sessionId, tabId, deltaY, ref);
  }

  wait(
    sessionId: string,
    tabId: string,
    request: BrowserWaitRequest,
  ): Promise<BrowserActionResult> {
    return this.manager.wait(sessionId, tabId, request);
  }

  history(
    sessionId: string,
    tabId: string,
    action: "back" | "forward" | "reload",
  ): Promise<BrowserActionResult> {
    return this.manager.history(sessionId, tabId, action);
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
    this.disposePromise ??= (async () => {
      for (const dispose of this.toolDisposers.splice(0).reverse()) dispose();
      await this.manager.dispose();
      await this.logger.close?.();
    })();
    return this.disposePromise;
  }
}
