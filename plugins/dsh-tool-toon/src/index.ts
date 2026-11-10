import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-tools";
import { createHostLoggerSink, getPluginLogger } from "@yadsh/dsh-plugin-log";
import {
  resolveToolToonConfig,
  ToolToonConfigSchema,
  type ToolToonConfig,
} from "./config.js";
import { createPostExecuteListener } from "./post-execute.js";

export {
  resolveToolToonConfig,
  ToolToonConfigSchema,
  type ToolToonConfig,
  type ResolvedToolToonConfig,
} from "./config.js";
export { formatJsonText } from "./format.js";
export {
  createPostExecuteListener,
  type ToolToonListener,
} from "./post-execute.js";

export const name = "dsh-tool-toon";
export const inject = ["tools"] as const;
export const Config = ToolToonConfigSchema;

/** Cordis entrypoint: the returned function disposes this plugin instance. */
export function apply(
  ctx: Context,
  raw: ToolToonConfig = {},
): () => Promise<void> {
  const config = resolveToolToonConfig(raw);
  const logger = getPluginLogger({
    pluginId: name,
    consoleSink: createHostLoggerSink(ctx.logger),
  });
  const unregister = config.enabled
    ? ctx.on("tools/post-execute", createPostExecuteListener(config, logger))
    : undefined;
  logger.info("plugin.applied", { enabled: config.enabled });
  return async () => {
    unregister?.();
    await logger.close();
  };
}
