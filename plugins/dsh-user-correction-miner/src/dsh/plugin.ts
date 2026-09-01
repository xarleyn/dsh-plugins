import type { Context } from "@deepseek-ai/cordis";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import {
  Config,
  resolveConfig,
  type UserCorrectionMinerConfig,
} from "../config.js";
import { CorrectionMinerEngine } from "../mining/engine.js";
import { createCorrectionsCommand } from "./commands.js";
import { registerLifecycle } from "./lifecycle.js";
import { createSessionSource } from "./sessions.js";
import {
  CORRECTION_MINER_DOMAIN,
  DomainCorrectionStore,
  type CorrectionMinerDomain,
} from "./storage.js";

export const name = "user-correction-miner";
export const inject = ["sessionQuery", "storageDomain"] as const;
export { Config };

function errorFields(error: unknown): Record<string, unknown> {
  return { reason: error instanceof Error ? error.message : String(error) };
}

async function closeResources(domain: CorrectionMinerDomain | undefined, logger: PluginLogger): Promise<void> {
  await domain?.close().catch((error: unknown) => {
    logger.warn("storage.close_failed", errorFields(error));
  });
  await logger.close();
}

/**
 * Host-only Phase 1 adapter. Mining failures are contained; no listener runs
 * in `agent/pre-step`, and this plugin never mutates instructions or policy.
 */
export async function apply(
  ctx: Context,
  rawConfig: UserCorrectionMinerConfig = {},
): Promise<() => Promise<void>> {
  const logger = getPluginLogger({
    pluginId: "dsh-user-correction-miner",
    console: "trace",
    consoleSink: createHostLoggerSink(ctx.logger),
  });
  let domain: CorrectionMinerDomain | undefined;
  let engine: CorrectionMinerEngine | undefined;
  try {
    const config = resolveConfig(rawConfig);
    if (!config.enabled) {
      logger.info("plugin.disabled");
      return async () => logger.close();
    }
    domain = await ctx.storageDomain.open(CORRECTION_MINER_DOMAIN);
    const createdEngine = new CorrectionMinerEngine(
      createSessionSource(ctx.sessionQuery),
      new DomainCorrectionStore(domain),
      config,
      logger.child("engine"),
    );
    engine = createdEngine;
    registerLifecycle(ctx, createdEngine);
    ctx.inject(["commands"], (commandCtx: any) =>
      commandCtx.commands.register(createCorrectionsCommand(createdEngine)),
    );
    logger.info("plugin.ready", {
      domain: CORRECTION_MINER_DOMAIN.name,
      maxRecordsPerWorkspace: config.retention.maxRecordsPerWorkspace,
      maxContextEvents: config.analysis.maxContextEvents,
      maxContextBytes: config.analysis.maxContextBytes,
    });
  } catch (error) {
    logger.error("plugin.initialization_failed", errorFields(error));
  }
  return async () => {
    engine?.dispose();
    await closeResources(domain, logger);
  };
}
