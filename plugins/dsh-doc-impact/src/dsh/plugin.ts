import { DocImpactEngine } from '../engine/runtime.js';
import type { EngineWorkspaceConfig } from '../engine/runtime.js';
import type { ImpactRule } from '../config/types.js';
import { createWorkspaceConfigSource } from './config-source.js';
import { resolvePluginConfig, type DocImpactPluginConfig } from './plugin-config.js';
import { registerLifecycle } from './lifecycle.js';
import { bootstrapSettings } from './settings.js';
import { createResolveTool, createStatusTool } from './tools.js';
import { createDocImpactCommand } from './commands.js';

export const name = 'doc-impact';

/** The tools service is required; commands and the web UI are optional services. */
export const inject = ['tools'] as const;

export interface PluginContext {
  on(event: string, listener: (...args: never[]) => unknown): unknown;
  inject(services: readonly string[], callback: (ctx: any) => void): unknown;
  get(service: string): unknown;
  tools: {
    register(definition: unknown): () => void;
  };
  agents?: {
    list(): readonly {
      readonly id: string;
      readonly status: 'idle' | 'running';
      readonly session: { readonly header?: { readonly cwd?: string } };
    }[];
  };
  logger: {
    info(message: string, ...values: unknown[]): void;
    warn(message: string, ...values: unknown[]): void;
    error(message: string, ...values: unknown[]): void;
  };
}

/**
 * dsh-doc-impact plugin entry (SPEC §14, §64): load config, wire the engine to
 * the public `agent/*` and `session/*` extension points, register the
 * `doc_impact_*` tools and the `/doc-impact` command, and expose the
 * `doc-impact` settings namespace behind Plugins → Plugin Configuration. No
 * agent-loop internals are imported or patched (SPEC §92-§93).
 */
export function apply(ctx: PluginContext, rawConfig?: unknown): void {
  let entryConfig: DocImpactPluginConfig;
  try {
    entryConfig = resolvePluginConfig(rawConfig);
  } catch (error) {
    ctx.logger.error('dsh-doc-impact: invalid plugin config, plugin disabled\n%s', error);
    return;
  }

  const logger = ctx.logger;
  // The effective config is live: before the settings namespace answers it is
  // the entry config; afterwards the merged settings view (entry config as the
  // composition base, user edits on top). `enabled: false` renders the engine
  // inert without unregistering the surface.
  let readConfig = (): DocImpactPluginConfig => entryConfig;
  void bootstrapSettings(ctx, rawConfig, entryConfig, (read) => {
    readConfig = read;
  }).catch((error: unknown) => {
    logger.warn('dsh-doc-impact: settings bootstrap failed (%s)', error);
  });

  const loadWorkspaceConfig = createWorkspaceConfigSource(() => readConfig(), logger);
  const engine = new DocImpactEngine({
    configProvider: async (cwd: string): Promise<EngineWorkspaceConfig | undefined> => {
      const config = readConfig();
      if (!config.enabled) return undefined;
      return loadWorkspaceConfig(cwd);
    },
    logger,
    concurrentAgents: (cwd: string): number =>
      ctx.agents?.list().filter(
        (agent) => agent.status === 'running' && agent.session.header?.cwd === cwd,
      ).length ?? 1,
  });

  registerLifecycle(ctx, engine);

  ctx.tools.register(createResolveTool({ engine }));
  ctx.tools.register(createStatusTool({ engine }));

  const rulesFor = async (cwd: string): Promise<ImpactRule[]> => {
    if (!readConfig().enabled) return [];
    const workspace = await loadWorkspaceConfig(cwd);
    return workspace?.config.rules ?? [];
  };

  const command = createDocImpactCommand(engine, { rulesFor });
  ctx.inject(['commands'], (commandCtx: any) => {
    commandCtx.commands.register(command);
  });

  ctx.logger.info('dsh-doc-impact: active (workspace config: %s)', entryConfig.configFile);
}
