import type { Context } from "@deepseek-ai/cordis";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { createHostLoggerSink, getPluginLogger } from "@yadsh/dsh-plugin-log";
import { ConfigSchema } from "./config.js";
import {
  resolvePluginConfig,
  type UIRepairPluginConfig,
} from "./shared/config.js";

export const name = "dsh-ui-repair";
export const inject: readonly string[] = [];
export const UI_REPAIR_SETTINGS_NAMESPACE = settingsNamespace("ui-repair");
export type Config = UIRepairPluginConfig;
export const Config = ConfigSchema;

/** Host companion. UI inspection intentionally remains in the browser realm. */
export function apply(
  ctx: Context,
  config: UIRepairPluginConfig = {},
): () => Promise<void> {
  const logger = getPluginLogger({
    pluginId: name,
    consoleSink: createHostLoggerSink(ctx.logger),
  });
  const entryConfig = structuredClone(config);
  let source = (): UIRepairPluginConfig => entryConfig;
  installSettingsSection(
    ctx,
    UI_REPAIR_SETTINGS_NAMESPACE,
    ConfigSchema,
    entryConfig,
    {
      setSource: (current) => {
        source = current;
      },
      onChange: () => {
        const resolved = resolvePluginConfig(source());
        logger.info("config.changed", {
          enabled: resolved.enabled,
          mode: resolved.mode,
          ignoreRules: resolved.ignore.length,
        });
      },
    },
  );
  const resolved = resolvePluginConfig(config);
  logger.info("plugin.ready", {
    enabled: resolved.enabled,
    mode: resolved.mode,
  });
  return async () => logger.close();
}

export type {
  RepairHistoryEntry,
  RepairIssue,
  RepairMode,
  ScanReport,
  UIRepairConfig,
  UIRepairService,
} from "./client/types.js";
export { ConfigSchema } from "./config.js";
export {
  DEFAULT_PLUGIN_CONFIG,
  REPAIR_MODES,
  REPAIR_RULE_IDS,
  resolvePluginConfig,
} from "./shared/config.js";
export type {
  ResolvedUIRepairPluginConfig,
  UIRepairIgnoreRule,
  UIRepairPluginConfig,
} from "./shared/config.js";
