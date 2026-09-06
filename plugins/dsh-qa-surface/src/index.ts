import { Service, type Context } from "@deepseek-ai/cordis";
import {
  installSettingsSection,
  settingsNamespace,
} from "@deepseek-ai/dsh-settings";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import { ConfigSchema, resolveConfig } from "./config.js";
import { registerQaNavigationRoute } from "./host-route.js";
import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "./types.js";

export const name = "qa-surface";
export const inject: readonly string[] = [];
export const QA_SURFACE_SETTINGS_NAMESPACE = settingsNamespace("qa-surface");
export const Config = ConfigSchema;

declare module "@deepseek-ai/cordis" {
  interface Context {
    qaSurface: QaSurface;
  }
}

/** Small Host companion: validates config and exposes it through DSH settings. */
export class QaSurface extends Service {
  static inject = inject;
  static Config = ConfigSchema;

  private source: () => QaSurfaceConfig;
  private readonly logger: PluginLogger;
  private webServer:
    Parameters<typeof registerQaNavigationRoute>[0] | undefined;
  private disposeRoute: (() => void) | undefined;
  private routeKey: string | undefined;

  constructor(ctx: Context, entry: QaSurfaceConfig = {}) {
    super(ctx, "qaSurface");
    const resolvedEntry = resolveConfig(entry);
    this.source = () => resolvedEntry;
    this.logger = getPluginLogger({
      pluginId: "dsh-qa-surface",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    ctx.effect(() => async () => this.logger.close(), "dsh-qa-surface.logger");
    installSettingsSection(
      ctx,
      QA_SURFACE_SETTINGS_NAMESPACE,
      ConfigSchema,
      entry,
      {
        setSource: (source) => {
          this.source = source;
        },
        onChange: () => {
          const config = this.getConfig();
          this.refreshRoute();
          this.logger.info("config.updated", {
            enabled: config.enabled,
            route: config.route.path,
            sessionPolicy: config.session.policy,
          });
        },
        validate: (value) => {
          resolveConfig(value);
        },
      },
    );
    ctx.inject(["webServer"], (webContext) => {
      this.webServer = webContext.webServer;
      this.refreshRoute();
      webContext.effect(
        () => () => {
          this.disposeRoute?.();
          this.disposeRoute = undefined;
          this.routeKey = undefined;
          this.webServer = undefined;
        },
        "dsh-qa-surface.navigation-route",
      );
    });
    this.logger.info("plugin.ready", {
      enabled: resolvedEntry.enabled,
      route: resolvedEntry.route.path,
      sessionPolicy: resolvedEntry.session.policy,
    });
  }

  getConfig(): ResolvedQaSurfaceConfig {
    return resolveConfig(this.source());
  }

  private refreshRoute(): void {
    const config = this.getConfig();
    const key = config.enabled
      ? `${config.route.path}:${config.route.matchChildren}`
      : undefined;
    if (key === this.routeKey) return;
    this.disposeRoute?.();
    this.disposeRoute = undefined;
    this.routeKey = undefined;
    if (key === undefined || this.webServer === undefined) return;
    this.disposeRoute = registerQaNavigationRoute(this.webServer, config);
    this.routeKey = key;
  }
}

export {
  ConfigSchema,
  DEFAULT_QA_SURFACE_CONFIG,
  normalizeRoutePath,
  resolveConfig,
} from "./config.js";
export { registerQaNavigationRoute } from "./host-route.js";
export type * from "./types.js";
export default QaSurface;
