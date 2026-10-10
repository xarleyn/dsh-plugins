import type { Context } from "@deepseek-ai/cordis";
import { createHostLoggerSink, getPluginLogger } from "@yadsh/dsh-plugin-log";
import { apply as applyProvider, Config } from "./upstream/index.js";
import type { Config as ProviderConfig } from "./upstream/config.js";

export { Config };
export { ExtendedAdapter } from "./adapter.js";
export type { GenerationDefaults } from "./generation.js";
export type {
  PiAiProviderProfile,
  PiAiModelProfile,
  Options,
} from "./upstream/config.js";
export {
  validateDecisionRequest,
  validateDecisionResponse,
} from "./systemone-contract.js";
export { supportedProtocols } from "./upstream/provider.js";

export const name = "dsh-llm-provider-extended";
export const inject: readonly string[] = ["llm"];

/** Cordis entrypoint: the returned function disposes this plugin instance. */
export function apply(
  ctx: Context,
  config: ProviderConfig,
): () => Promise<void> {
  const logger = getPluginLogger({
    pluginId: name,
    consoleSink: createHostLoggerSink(ctx.logger),
  });
  applyProvider(ctx, config);
  logger.info("provider.applied", {
    routes: Object.keys(config.providers.get()).length,
  });
  return async () => {
    await logger.close();
  };
}
