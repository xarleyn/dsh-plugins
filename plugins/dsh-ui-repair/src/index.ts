import type { Context } from "@deepseek-ai/cordis";
import { createHostLoggerSink, getPluginLogger } from "@yadsh/dsh-plugin-log";
import { ConfigSchema } from "./config.js";
import { resolveVolatileConfig } from "./shared/config.js";

export const name = "dsh-ui-repair";
export const inject: readonly string[] = [];
export type Config = ReturnType<typeof ConfigSchema>;
export const Config = ConfigSchema;

/** Host companion. UI inspection intentionally remains in the browser realm. */
export function apply(ctx: Context, config: Config): () => Promise<void> {
  const logger = getPluginLogger({
    pluginId: name,
    consoleSink: createHostLoggerSink(ctx.logger),
  });
  const resolved = resolveVolatileConfig(config);
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
  resolveVolatileConfig,
  UI_REPAIR_SETTINGS_NAMESPACE,
} from "./shared/config.js";
export type {
  ResolvedUIRepairPluginConfig,
  UIRepairIgnoreRule,
  UIRepairPluginConfig,
  UIRepairVolatileConfig,
} from "./shared/config.js";
