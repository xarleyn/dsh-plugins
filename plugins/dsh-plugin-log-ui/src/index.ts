import { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  createHostLoggerSink,
  getPluginLogger,
  getRegisteredPluginLoggers,
  setPluginLogFormat,
  setPluginLogLevel,
  subscribePluginLogRecords,
  subscribePluginLoggerRegistry,
} from "@yadsh/dsh-plugin-log";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { ConfigSchema, resolveConfig } from "./config.js";
import { PluginLogBuffer } from "./log-buffer.js";
import type {
  PluginLogConsumerSnapshot,
  PluginLogTail,
  PluginLogUiConfig,
  PluginLogUiService,
  PluginLogUiSnapshot,
  ResolvedPluginLogUiConfig,
  VolatilePluginLogUiConfig,
} from "./types.js";

export const name = "plugin-log-ui";
export const inject: readonly string[] = [];
/**
 * The Cordis profile entry this plugin is loaded under. Since `0.1.7` the
 * settings namespace of a live Config *is* that id, so the browser card resolves
 * its form by this string rather than by a namespace the plugin invented.
 */
export const PLUGIN_LOG_ENTRY_ID = "dsh-plugin-log-ui";
export type Config = PluginLogUiConfig;
export const Config = ConfigSchema;

declare module "@deepseek-ai/cordis" {
  interface Context {
    pluginLogUi: PluginLogUiService;
  }
}

export class PluginLogUi
  extends TypertRemoteService
  implements PluginLogUiService
{
  static inject = inject;
  static Config = ConfigSchema;

  private readonly config: VolatilePluginLogUiConfig;
  private applying = false;
  private readonly logger: PluginLogger;
  /** Live output for the right-Sidebar panel; the file destination cannot serve it. */
  private readonly buffer = new PluginLogBuffer();

  constructor(ctx: Context, input: VolatilePluginLogUiConfig) {
    super(ctx, "pluginLogUi", { namespace: "pluginLogUi" });
    this.logger = getPluginLogger({
      pluginId: "dsh-plugin-log-ui",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    this.config = input;
    ctx.effect(
      () => async () => this.logger.close(),
      "dsh-plugin-log-ui.logger",
    );
    // Every plugin's records reach the panel, this plugin's own diagnostics
    // included: the stream is the host's output, not one plugin's.
    ctx.effect(
      () => subscribePluginLogRecords((record) => this.buffer.append(record)),
      "dsh-plugin-log-ui.record-bus",
    );

    ctx.effect(
      () => subscribePluginLoggerRegistry(() => this.applyPolicy()),
      "dsh-plugin-log-ui.registry",
    );
    this.applyPolicy();
    this.logger.info("plugin.ready");
  }

  /**
   * The Config as it stands right now. Each field is read through its live
   * reference, so an edit the Host made since the last call is in this answer;
   * a snapshot taken once and held would freeze the policy at boot.
   */
  getConfig(): ResolvedPluginLogUiConfig {
    return resolveConfig({
      defaultLevel: this.config.defaultLevel.get(),
      format: this.config.format.get(),
      levels: this.config.levels.get(),
    });
  }

  @Remote("tail")
  tail(cursor: number, limit: number): PluginLogTail {
    return this.buffer.read(cursor, limit);
  }

  @Remote("inspect")
  inspect(): PluginLogUiSnapshot {
    this.applyPolicy();
    const grouped = new Map<string, PluginLogConsumerSnapshot>();
    for (const logger of getRegisteredPluginLoggers()) {
      const existing = grouped.get(logger.pluginId);
      grouped.set(logger.pluginId, {
        pluginId: logger.pluginId,
        level: logger.level,
        format: logger.format,
        instances: (existing?.instances ?? 0) + 1,
      });
    }
    return {
      consumers: [...grouped.values()].sort((left, right) =>
        left.pluginId.localeCompare(right.pluginId),
      ),
    };
  }

  private applyPolicy(): void {
    if (this.applying) return;
    this.applying = true;
    try {
      const config = this.getConfig();
      setPluginLogFormat(config.format);
      const seen = new Set<string>();
      for (const logger of getRegisteredPluginLoggers()) {
        if (seen.has(logger.pluginId)) continue;
        seen.add(logger.pluginId);
        setPluginLogLevel(
          logger.pluginId,
          config.levels[logger.pluginId] ?? config.defaultLevel,
        );
      }
      this.logger.debug("logging.policy.applied", {
        consumers: seen.size,
        defaultLevel: config.defaultLevel,
        format: config.format,
      });
    } finally {
      this.applying = false;
    }
  }
}

export { ConfigSchema, resolveConfig } from "./config.js";
export type * from "./types.js";
export default PluginLogUi;
