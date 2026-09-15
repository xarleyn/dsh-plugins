import { Context } from "@deepseek-ai/cordis";
import { hostname, networkInterfaces } from "node:os";
import type {} from "@deepseek-ai/dsh-agent";
import type { AttachmentStore, ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import type {} from "@deepseek-ai/dsh-tools";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
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
  BrowserPanelFrame,
  BrowserPanelState,
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
import {
  createBrowserCoreTools,
  createBrowserVisionTools,
} from "./tools/index.js";

export interface QaBrowserServiceDependencies {
  readonly provider?: BrowserProvider;
  readonly logger?: BrowserRuntimeLogger;
  readonly dshOrigins?: readonly string[];
  readonly now?: () => number;
  readonly startIdleTimer?: boolean;
}

function activeDshOrigins(ctx: Context): readonly string[] {
  const server = (
    ctx as Context & {
      readonly webServer?: { readonly port: number; readonly host: string };
    }
  ).webServer;
  if (server === undefined || server.port <= 0) return [];
  const hosts = new Set(["127.0.0.1", "localhost", hostname()]);
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) hosts.add(entry.address);
  }
  return [...hosts].map((host) => {
    const bracketed = host.includes(":") ? `[${host}]` : host;
    return `http://${bracketed}:${server.port}`;
  });
}

/** Public Host service. Browser state is keyed only by DSH session id. */
export class QaBrowserService extends TypertRemoteService {
  static inject = ["agents", "attachments", "tools", "webServer"];
  static Config = QaBrowserConfigSchema;

  readonly config: ResolvedQaBrowserConfig;
  private readonly manager: QaBrowserSessionManager;
  private readonly logger: BrowserRuntimeLogger & { close?(): Promise<void> };
  private readonly attachments: AttachmentStore;
  private readonly context: Context;
  private readonly toolDisposers: (() => void)[] = [];
  private disposePromise: Promise<void> | undefined;

  constructor(
    ctx: Context,
    config: QaBrowserConfig = {},
    dependencies: QaBrowserServiceDependencies = {},
  ) {
    super(ctx, "qaBrowser");
    this.context = ctx;
    this.attachments = ctx.attachments;
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
        dshOrigins:
          dependencies.dshOrigins ??
          [
            ...activeDshOrigins(ctx),
            ...this.config.security.network.dshOrigins,
          ],
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
    if (this.config.enabled && this.config.capabilities.vision) {
      for (const definition of createBrowserVisionTools(this)) {
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

  /** Raw screenshot primitive for trusted Host integrations such as QA Surface. */
  screenshot(sessionId: string, tabId: string): Promise<Buffer> {
    return this.manager.screenshot(sessionId, tabId);
  }

  async screenshotArtifact(
    sessionId: string,
    tabId: string,
  ): Promise<ImageAttachmentRef> {
    const image = await this.manager.screenshot(sessionId, tabId);
    return this.attachments.saveImage({
      data: image,
      mediaType: "image/png",
      name: `qa-browser-${tabId}.png`,
    });
  }

  async panelState(
    qaToken: string,
    sessionId: string,
  ): Promise<BrowserPanelState> {
    await this.authorizePanel(qaToken, sessionId);
    const session = this.manager.getSession(sessionId);
    return {
      session,
      tabs: session === null ? [] : await this.manager.listTabs(sessionId),
      autoRevealOnAgentActivity: this.config.ui.autoRevealOnAgentActivity,
      focusOnAutoReveal: this.config.ui.focusOnAutoReveal,
    };
  }

  async panelFrame(
    qaToken: string,
    sessionId: string,
    tabId: string,
  ): Promise<BrowserPanelFrame> {
    await this.authorizePanel(qaToken, sessionId);
    const tab = (await this.manager.listTabs(sessionId)).find(
      (candidate) => candidate.id === tabId,
    );
    if (tab === undefined) {
      throw new Error("QA Browser panel tab is unavailable.");
    }
    const data = await this.manager.screenshot(sessionId, tabId);
    if (data.byteLength > 5 * 1024 * 1024) {
      throw new Error("QA Browser panel frame exceeds the 5 MiB transport limit.");
    }
    return {
      tabId,
      revision: tab.revision,
      url: tab.url,
      title: tab.title,
      mediaType: "image/png",
      bytes: data.byteLength,
      data: data.toString("base64"),
    };
  }

  private async authorizePanel(
    qaToken: string,
    sessionId: string,
  ): Promise<void> {
    const qaSurface = (
      this.context as Context & {
        readonly qaSurface?: {
          secureSession(token: string, id: string): Promise<unknown>;
        };
      }
    ).qaSurface;
    if (qaSurface === undefined) {
      throw new Error("QA Browser panel authorization is unavailable.");
    }
    await qaSurface.secureSession(qaToken, sessionId);
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

type RemoteMethod = "panelState" | "panelFrame";

function registerRemoteMethod(method: RemoteMethod): void {
  const initializers: Array<(this: object) => void> = [];
  const decorate = Remote as unknown as (
    value: (...args: unknown[]) => unknown,
    context: {
      readonly name: string;
      readonly private: boolean;
      readonly static: boolean;
      addInitializer(initializer: (this: object) => void): void;
    },
  ) => void;
  decorate(
    QaBrowserService.prototype[method] as unknown as (
      ...args: unknown[]
    ) => unknown,
    {
      name: method,
      private: false,
      static: false,
      addInitializer(initializer) {
        initializers.push(initializer);
      },
    },
  );
  const markerReceiver = Object.create(QaBrowserService.prototype) as object;
  for (const initializer of initializers) initializer.call(markerReceiver);
}

for (const method of ["panelState", "panelFrame"] as const) {
  registerRemoteMethod(method);
}
