import type { Context } from "@deepseek-ai/cordis";
import { getPluginLogger } from "@yadsh/dsh-plugin-log";
import { HumanizerClient } from "./client.js";
import { Config, resolveConfig, type HumanizerConfig } from "./config.js";
import { createRewriteTool, createStatusTool } from "./tools.js";

export { Config, resolveConfig, DEFAULTS } from "./config.js";
export type { HumanizerConfig, ResolvedHumanizerConfig } from "./config.js";
export { HumanizerClient, HumanizerError } from "./client.js";
export { createRewriteTool, createStatusTool } from "./tools.js";
export type { RewriteResult, StatusResult } from "./tools.js";

export const name = "dsh-humanizer";
export const inject = ["tools"];

/** Cordis entrypoint: the returned function disposes this plugin instance. */
export function apply(
  ctx: Context,
  rawConfig: HumanizerConfig = {},
): () => Promise<void> {
  const config = resolveConfig(rawConfig);
  if (!config.enabled) return async () => {};
  const logger = getPluginLogger({ pluginId: name });
  const lifecycle = new AbortController();
  const deps = {
    config,
    logger,
    lifecycle: lifecycle.signal,
    client: new HumanizerClient(config),
  };
  const removers: (() => void)[] = [];
  try {
    removers.push(ctx.tools.register(createRewriteTool(deps)));
    removers.push(ctx.tools.register(createStatusTool(deps)));
  } catch (error) {
    lifecycle.abort();
    for (const remove of removers.reverse()) remove();
    void logger.close();
    throw error;
  }
  logger.info("plugin.applied", { authenticated: config.apiKey !== "" });
  let disposed = false;
  return async () => {
    if (disposed) return;
    disposed = true;
    lifecycle.abort();
    for (const remove of removers.reverse()) remove();
    await logger.close();
  };
}

export default { name, inject, Config, apply };
