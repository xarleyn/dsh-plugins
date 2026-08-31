import type { Context } from "@deepseek-ai/cordis";
import { createHostLoggerSink, getPluginLogger } from "@yadsh/dsh-plugin-log";

/** Host lifecycle companion; translation diagnostics remain browser-local. */
export function apply(ctx: Context): () => Promise<void> {
  const logger = getPluginLogger({
    pluginId: "dsh-l10n-overrides",
    consoleSink: createHostLoggerSink(ctx.logger),
  });
  logger.info("plugin.ready");
  return async () => logger.close();
}
