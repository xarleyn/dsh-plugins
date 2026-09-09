import type { Context } from "@deepseek-ai/cordis";
import { createHostLoggerSink, getPluginLogger } from "@yadsh/dsh-plugin-log";

export const name = "dsh-ui-repair";

/** Host companion. UI inspection intentionally remains in the browser realm. */
export function apply(ctx: Context): () => Promise<void> {
  const logger = getPluginLogger({
    pluginId: name,
    consoleSink: createHostLoggerSink(ctx.logger),
  });
  logger.info("plugin.ready", {
    mode: "browser-owned",
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
