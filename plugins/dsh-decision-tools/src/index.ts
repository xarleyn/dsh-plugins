import type { Context } from "@deepseek-ai/cordis";
import { createHostLoggerSink, getPluginLogger } from "@yadsh/dsh-plugin-log";
import {
  ConfigSchema,
  resolveConfig,
  type DecisionToolsConfig,
} from "./config.js";
import { DecisionClient } from "./client.js";
import { createTools, TOOL_NAMES } from "./tools.js";

export { ConfigSchema, resolveConfig } from "./config.js";
export type { DecisionToolsConfig, BackendConfig } from "./config.js";
export { DecisionClient, Gate } from "./client.js";
export { createTools, TOOL_NAMES } from "./tools.js";
export { DecisionError } from "./types.js";

export const name = "dsh-decision-tools";
export const inject = ["tools"] as const;
export const Config = ConfigSchema;

/** Cordis entrypoint: the returned function disposes this plugin instance. */
export function apply(
  ctx: Context,
  raw: DecisionToolsConfig = {},
): () => Promise<void> {
  const config = resolveConfig(raw);
  const logger = getPluginLogger({
    pluginId: name,
    consoleSink: createHostLoggerSink(ctx.logger),
  });
  const client = new DecisionClient(config);
  const removers: (() => void)[] = [];
  try {
    if (config.enabled)
      for (const tool of createTools(client))
        removers.push(ctx.tools.register(tool));
    logger.info(config.enabled ? "plugin.applied" : "plugin.disabled", {
      tools: config.enabled ? [...TOOL_NAMES] : [],
    });
  } catch (error) {
    client.close();
    for (const remove of removers.reverse()) remove();
    void logger.close();
    throw error;
  }
  return async () => {
    client.close();
    for (const remove of removers.splice(0).reverse()) remove();
    await logger.close();
  };
}
