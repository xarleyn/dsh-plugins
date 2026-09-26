import { DocImpactEngine } from "../engine/runtime.js";
import type { EngineWorkspaceConfig } from "../engine/runtime.js";
import type { ImpactRule } from "../config/types.js";
import { createWorkspaceConfigSource } from "./config-source.js";
import {
  ConfigSchema,
  plainEntryConfig,
  readLiveConfig,
  resolvePluginConfig,
  type DocImpactEntryConfig,
  type DocImpactPluginConfig,
} from "./plugin-config.js";
import { createEngineFileLogger } from "./engine-logger.js";
import { registerLifecycle } from "./lifecycle.js";
import { createResolveTool, createStatusTool } from "./tools.js";
import { createDocImpactCommand } from "./commands.js";

export const name = "doc-impact";

/**
 * The entry configuration (SPEC §37). On `0.1.7` this schema *is* the settings
 * surface: the profile entry id `dsh-doc-impact` is the namespace the browser
 * card edits, and a field is editable live because its node is volatile.
 */
export type Config = DocImpactEntryConfig;
export const Config = ConfigSchema;

/** The tools service is required; agents, commands, and the web UI are optional services. */
export const inject = ["tools"] as const;

/** Structural view of the `agents` service the attribution probe consumes. */
export interface AgentsServiceLike {
  list(): readonly {
    readonly id: string;
    readonly status: "idle" | "running";
    readonly session: { readonly header?: { readonly cwd?: string } };
  }[];
}

/** Structural view of the host `commands` service the plugin registers into. */
export interface CommandRegistryLike {
  commands: { register(definition: unknown): unknown };
}

export interface PluginContext {
  on(event: string, listener: (...args: never[]) => unknown): unknown;
  /** Callback receives the injected-service host; declare its shape at the callsite. */
  inject<TContext>(
    services: readonly string[],
    callback: (ctx: TContext) => void,
  ): unknown;
  effect(callback: () => (() => void) | void, name?: string): unknown;
  tools: {
    register(definition: unknown): () => void;
  };
  logger: {
    info(message: string, ...values: unknown[]): void;
    warn(message: string, ...values: unknown[]): void;
    error(message: string, ...values: unknown[]): void;
  };
}

/**
 * Structural view of the host `settings` service — only the page policy this
 * entry decides, so the entry keeps no hard dependency on an optional service.
 */
export interface SettingsFormsLike {
  configure(presentation: { auto?: boolean }): () => void;
}

/**
 * dsh-doc-impact plugin entry (SPEC §14, §64): load config, wire the engine to
 * the public `agent/*` and `session/*` extension points, register the
 * `doc_impact_*` tools and the `/doc-impact` command, and keep the
 * `dsh-doc-impact` settings namespace behind Settings → Plugins. No
 * agent-loop internals are imported or patched (SPEC §92-§93).
 */
export function apply(
  ctx: PluginContext,
  config?: DocImpactEntryConfig | Record<string, unknown>,
): void {
  try {
    resolvePluginConfig(plainEntryConfig(config));
  } catch (error) {
    ctx.logger.error(
      "dsh-doc-impact: invalid plugin config, plugin disabled\n%s",
      error,
    );
    return;
  }

  const logger = ctx.logger;
  // Runtime diagnostics (engine + workspace config source) land in the
  // plugin log directory and keep mirroring to the host console.
  const engineLogger = createEngineFileLogger(logger);
  // The effective config is live: every field the card edits is a volatile
  // reference, so each operation takes one plain snapshot instead of reading a
  // copy made at startup. `enabled: false` renders the engine inert without
  // unregistering the surface.
  const readConfig = (): DocImpactPluginConfig => readLiveConfig(config);
  // The browser card owns this namespace, so the Host is told not to generate a
  // second editor over the same fields.
  ctx.inject(["settings"], (settingsCtx: { settings?: SettingsFormsLike }) => {
    const settings = settingsCtx.settings;
    if (settings === undefined) return;
    ctx.effect(
      () => settings.configure({ auto: false }),
      "dsh-doc-impact.settings-presentation",
    );
  });

  const loadWorkspaceConfig = createWorkspaceConfigSource(
    () => readConfig(),
    engineLogger,
  );
  // The attribution probe (SPEC §49) asks the `agents` service how many agents
  // run in the same workspace. The service stays optional and is captured
  // softly, so the plugin loads (and stays inert in attribution) on hosts that
  // never publish it. Accessing the property directly instead throws
  // `cannot get property "agents" without inject`, which used to fail every
  // stop check open right before the reminder was built.
  let agents: AgentsServiceLike | undefined;
  ctx.inject(["agents"], (agentsCtx: { agents?: AgentsServiceLike }) => {
    agents = agentsCtx.agents;
  });
  const engine = new DocImpactEngine({
    configProvider: async (
      cwd: string,
    ): Promise<EngineWorkspaceConfig | undefined> => {
      const config = readConfig();
      if (!config.enabled) return undefined;
      return loadWorkspaceConfig(cwd);
    },
    steeringEnabled: () => readConfig().steer,
    messageTemplates: () => {
      const config = readConfig();
      return {
        reminder: config.reminderTemplate,
        limit: config.limitTemplate,
      };
    },
    logger: engineLogger,
    concurrentAgents: (cwd: string): number =>
      agents
        ?.list()
        .filter(
          (agent) =>
            agent.status === "running" && agent.session.header?.cwd === cwd,
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
  ctx.inject(["commands"], (commandCtx: CommandRegistryLike) => {
    commandCtx.commands.register(command);
  });

  ctx.logger.info(
    "dsh-doc-impact: active (workspace config: %s)",
    readConfig().configFile,
  );
}
