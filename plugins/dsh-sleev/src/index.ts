import { Context, Service } from "@deepseek-ai/cordis";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import {
  installSettingsSection,
  settingsNamespace,
} from "@deepseek-ai/dsh-settings";
import {
  ConfigSchema,
  matchesOptimizedRoute,
  resolveConfig,
} from "./shared/config.js";
import type { Config } from "./shared/config.js";
import type { OptimizerCallTelemetry } from "./shared/telemetry.js";
import { SLEEV_SETTINGS_NAMESPACE_ID } from "./shared/settings.js";
import { classifyRequest } from "./host/request-classifier.js";
import { observeStream } from "./host/stream-observer.js";
import { CallTelemetryStore } from "./host/telemetry-store.js";

export const name = "dsh-sleev";

/** User-editable settings section rendered by the browser client card. */
export const SLEEV_SETTINGS_NAMESPACE = settingsNamespace(
  SLEEV_SETTINGS_NAMESPACE_ID,
);

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

  constructor(ctx: Context, input: Config = {}) {
    super(ctx, "sleev");
    const resolvedEntry = resolveConfig(input);
    const entry: Config = {
      routes: [...resolvedEntry.routes],
      routePrefixes: [...resolvedEntry.routePrefixes],
      maxRecentCalls: resolvedEntry.maxRecentCalls,
      logLevel: resolvedEntry.logLevel,
    };
    let configSource: () => Config = () => entry;
    this.telemetry = new CallTelemetryStore(ctx.logger, () =>
      resolveConfig(configSource()),
    );

    installSettingsSection(ctx, SLEEV_SETTINGS_NAMESPACE, ConfigSchema, entry, {
      setSource: (current) => {
        configSource = current;
      },
      // Route matching and telemetry policy read through configSource for
      // each operation, so a committed setting needs no re-registration.
      onChange: () => this.telemetry.reconfigure(),
    });

    ctx.on(
      "llm/stream",
      (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
        const config = resolveConfig(configSource());
        if (!matchesOptimizedRoute(options.provider, config)) return next();
        const handle = this.telemetry.begin(options, classifyRequest(options));
        return observeStream(next(), handle);
      },
      { global: true },
    );

    if (resolvedEntry.logLevel !== "off") {
      ctx.logger.info(
        `dsh-sleev: observer active ${JSON.stringify({ routes: resolvedEntry.routes, routePrefixes: resolvedEntry.routePrefixes })}`,
      );
    }
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
