import { Context, Service } from "@deepseek-ai/cordis";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-settings";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
  type PluginLogLevel,
} from "@yadsh/dsh-plugin-log";
import {
  ConfigSchema,
  matchesOptimizedRoute,
  resolveConfig,
  snapshotConfig,
} from "./shared/config.js";
import type { Config, ResolvedConfig } from "./shared/config.js";
import type { OptimizerCallTelemetry } from "./shared/telemetry.js";
import { SLEEV_SETTINGS_NAMESPACE_ID } from "./shared/settings.js";
import { classifyRequest } from "./host/request-classifier.js";
import { observeStream } from "./host/stream-observer.js";
import { CallTelemetryStore } from "./host/telemetry-store.js";

export const name = "dsh-sleev";

function pluginLogLevel(level: ResolvedConfig["logLevel"]): PluginLogLevel {
  return level === "off" ? "silent" : level;
}

/** Settings namespace the browser card edits, i.e. the profile entry id. */
export const SLEEV_SETTINGS_NAMESPACE = SLEEV_SETTINGS_NAMESPACE_ID;

declare module "@deepseek-ai/cordis" {
  interface Context {
    sleev: SleevIntegrationService;
  }
}

/** Host-side observer service. Routing itself remains owned by llm-pi-ai. */
export class SleevIntegrationService extends Service {
  static inject = ["llm"];
  static Config = ConfigSchema;

  private readonly telemetry: CallTelemetryStore;
  private readonly logger: PluginLogger;
  private appliedConfig: ResolvedConfig;

  constructor(ctx: Context, input: Config) {
    super(ctx, "sleev");
    const entry = resolveConfig(snapshotConfig(input));
    this.appliedConfig = entry;
    this.logger = getPluginLogger({
      pluginId: "dsh-sleev",
      level: pluginLogLevel(entry.logLevel),
      console: "trace",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    ctx.effect(() => async () => this.logger.close(), "dsh-sleev.logger");
    const readConfig = (): ResolvedConfig => this.currentConfig(input);
    this.telemetry = new CallTelemetryStore(
      this.logger.child("telemetry"),
      readConfig,
    );

    /*
     * Every editable field carries `.volatile()`, so the Loader serves the
     * entry itself as the settings namespace and the browser card edits it
     * through `ctx.configForms`. `auto: false` keeps the Host from generating a
     * second page for the values our own card already presents.
     */
    ctx.inject(["settings"], (settingsCtx) => {
      settingsCtx.effect(
        () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
        "dsh-sleev.settings-presentation",
      );
    });

    ctx.on(
      "llm/stream",
      (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
        const config = readConfig();
        if (!matchesOptimizedRoute(options.provider, config)) return next();
        const handle = this.telemetry.begin(options, classifyRequest(options));
        return observeStream(next(), handle);
      },
      { global: true },
    );

    if (entry.logLevel !== "off") {
      this.logger.info("plugin.ready", {
        routes: entry.routes,
        routePrefixes: entry.routePrefixes,
      });
    }
  }

  /**
   * Read one configuration snapshot and apply what a committed edit changes.
   *
   * The Loader swaps a volatile value inside the same reference instead of
   * re-constructing this service, so the logger level and the retention bound
   * follow on the first read that sees them.
   */
  private currentConfig(input: Config): ResolvedConfig {
    const config = resolveConfig(snapshotConfig(input));
    const previous = this.appliedConfig;
    if (
      config.logLevel === previous.logLevel &&
      config.maxRecentCalls === previous.maxRecentCalls
    ) {
      return config;
    }
    this.appliedConfig = config;
    this.logger.setLevel(pluginLogLevel(config.logLevel));
    this.telemetry.reconfigure();
    this.logger.info("telemetry.config.updated", {
      logLevel: config.logLevel,
      maxRecentCalls: config.maxRecentCalls,
    });
    return config;
  }

  /** Bounded completed-call snapshot; no prompts, headers, or credentials. */
  listRecentCalls(): readonly OptimizerCallTelemetry[] {
    return this.telemetry.listRecent();
  }
}

export { classifyRequest } from "./host/request-classifier.js";
export { observeStream } from "./host/stream-observer.js";
export { CallTelemetryStore } from "./host/telemetry-store.js";
export { deriveUsage, normalizeUsage } from "./host/usage.js";
export {
  ConfigSchema,
  matchesOptimizedRoute,
  resolveConfig,
} from "./shared/config.js";
export type { Config, ResolvedConfig } from "./shared/config.js";
export type * from "./shared/telemetry.js";

export default SleevIntegrationService;
