import { Context } from "@deepseek-ai/cordis";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  getRegisteredPluginLoggers,
  setPluginLogFormat,
  setPluginLogLevel,
  subscribePluginLoggerRegistry,
} from "@yadsh/dsh-plugin-log";
import { ConfigSchema, resolveConfig } from "./config.js";
import type {
  PluginLogConsumerSnapshot,
  PluginLogUiConfig,
  PluginLogUiService,
  PluginLogUiSnapshot,
  ResolvedPluginLogUiConfig,
} from "./types.js";

export const name = "plugin-log-ui";
export const inject: readonly string[] = [];
export const PLUGIN_LOG_SETTINGS_NAMESPACE = settingsNamespace("plugin-log");
export type Config = PluginLogUiConfig;
export const Config = ConfigSchema;

declare module "@deepseek-ai/cordis" {
  interface Context {
    pluginLogUi: PluginLogUiService;
  }
}

export class PluginLogUi extends TypertRemoteService implements PluginLogUiService {
  static inject = inject;
  static Config = ConfigSchema;

  private configSource: () => PluginLogUiConfig;
  private applying = false;

  constructor(ctx: Context, input: PluginLogUiConfig = {}) {
    super(ctx, "pluginLogUi", { namespace: "pluginLogUi" });
    const entry = resolveConfig(input);
    this.configSource = () => entry;

    installSettingsSection(ctx, PLUGIN_LOG_SETTINGS_NAMESPACE, ConfigSchema, entry, {
      setSource: (current) => {
        this.configSource = current;
      },
      onChange: () => this.applyPolicy(),
    });

    ctx.effect(
      () => subscribePluginLoggerRegistry(() => this.applyPolicy()),
      "dsh-plugin-log-ui.registry",
    );
    this.applyPolicy();
  }

  getConfig(): ResolvedPluginLogUiConfig {
    return resolveConfig(this.configSource());
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
    } finally {
      this.applying = false;
    }
  }
}

export { ConfigSchema, resolveConfig } from "./config.js";
export type * from "./types.js";
export default PluginLogUi;
