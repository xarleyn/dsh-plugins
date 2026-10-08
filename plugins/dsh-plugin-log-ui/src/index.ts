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
import {
  TemporaryLevels,
  type TemporaryLevelScheduler,
} from "./temporary-levels.js";
import type {
  ManagedPluginLogLevel,
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

/**
 * Seams a test drives a held window through: the clock the window is counted
 * against and the timer that closes it. A Host never passes either — a pending
 * level then runs on `Date.now` and on the process timer, which is what an
 * operator standing in front of the card needs.
 */
export interface PluginLogUiOptions {
  readonly now?: (() => number) | undefined;
  readonly schedule?: TemporaryLevelScheduler | undefined;
}

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
  private readonly temporary: TemporaryLevels;
  private applying = false;
  private readonly logger: PluginLogger;
  /** Live output for the right-Sidebar panel; the file destination cannot serve it. */
  private readonly buffer = new PluginLogBuffer();

  constructor(
    ctx: Context,
    input: VolatilePluginLogUiConfig,
    options: PluginLogUiOptions = {},
  ) {
    super(ctx, "pluginLogUi", { namespace: "pluginLogUi" });
    this.logger = getPluginLogger({
      pluginId: "dsh-plugin-log-ui",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    this.config = input;
    this.temporary = new TemporaryLevels({
      now: options.now,
      schedule: options.schedule,
      // The window closing is a change of policy: the plugin goes back to what
      // its settings say without waiting for a browser to ask.
      onLapse: () => this.applyPolicy(),
    });
    ctx.effect(
      () => () => this.temporary.dispose(),
      "dsh-plugin-log-ui.temporary-levels",
    );
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
      temporary: this.temporary.list(),
    };
  }

  /**
   * Hold one plugin at `level` for a window, or until it is revoked, and answer
   * with the snapshot the card repaints from. Nothing here touches the Config: the
   * level is the live call a saved override ends in, and it is gone on its own.
   */
  @Remote("setTemporaryLevel")
  setTemporaryLevel(
    pluginId: string,
    level: ManagedPluginLogLevel,
    minutes?: number,
  ): PluginLogUiSnapshot {
    this.temporary.set(pluginId, level, minutes);
    this.applyPolicy();
    this.logger.info("logging.temporary.set", {
      pluginId,
      level,
      minutes: minutes ?? "until revoked",
    });
    return this.inspect();
  }

  /**
   * Release one held level before its window closes and hand back what the
   * settings say instead.
   */
  @Remote("clearTemporaryLevel")
  clearTemporaryLevel(pluginId: string): PluginLogUiSnapshot {
    this.temporary.clear(pluginId);
    this.applyPolicy();
    this.logger.info("logging.temporary.clear", { pluginId });
    return this.inspect();
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
        // The held window wins over the saved override, and it wins because the
        // registry callback and the card's poll both land here: reading the
        // settings alone would drop a DEBUG the operator is still watching on the
        // next logger registration.
        setPluginLogLevel(
          logger.pluginId,
          this.temporary.levelOf(logger.pluginId) ??
            config.levels[logger.pluginId] ??
            config.defaultLevel,
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
