import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { QaToolActivationManager } from "./activation-manager.js";
import { QaToolActivationDetector } from "./activation-detector.js";
import { createQaToolCatalog, QA_TOOL_CATALOG_VERSION } from "./catalog.js";
import { sessionLoadedSkill } from "./durable-marker.js";
import { QaToolActivationLifecycle } from "./lifecycle.js";
import type { QaToolActivation } from "./types.js";

export interface QaToolsOptions {
  readonly logger: PluginLogger;
  readonly dynamicActivation: boolean;
  readonly activationSkill: string;
  readonly activationMode: string;
  readonly activationPresets: readonly string[];
  /** Documentation root the readers use; `""` reads each chat's own `docs/`. */
  readonly docsRoot: string;
}

/**
 * The QA tool subsystem: one catalog, one per-agent activation manager, and the
 * two edges that drive it — the skill-result detector and the agent lifecycle.
 *
 * `dsh-qa-surface` owns the tools but never registers them at boot. Nothing in
 * the catalog reaches the model until an agent it belongs to loads the
 * activation skill, so the initial request of a session carries only the
 * composition's own schemas.
 */
export class QaTools implements QaToolActivation {
  private readonly manager: QaToolActivationManager;
  private readonly detector: QaToolActivationDetector;
  private readonly lifecycle: QaToolActivationLifecycle;
  private readonly catalogTools: readonly string[];

  constructor(
    private readonly ctx: Context,
    private readonly options: QaToolsOptions,
  ) {
    // The self-check tool answers about whichever agent calls it, so the
    // catalog is built before any agent exists and resolves `exec.agent` at
    // execution time.
    const catalog = createQaToolCatalog({
      catalogVersion: QA_TOOL_CATALOG_VERSION,
      activationMode: options.activationMode,
      catalogTools: () => this.catalogTools,
      activeTools: (agent) => this.manager.activeToolNames(agent),
      skillLoaded: (agent) =>
        sessionLoadedSkill(agent.session, options.activationSkill),
      docsRoot: options.docsRoot,
    });
    this.catalogTools = catalog.map((entry) => entry.definition.name);
    this.manager = new QaToolActivationManager({
      catalog,
      catalogVersion: QA_TOOL_CATALOG_VERSION,
      logger: options.logger,
    });
    this.detector = new QaToolActivationDetector(ctx, {
      manager: this.manager,
      logger: options.logger,
      activationSkill: options.activationSkill,
      isManagedAgent: (agent) => this.isManagedAgent(agent),
    });
    this.lifecycle = new QaToolActivationLifecycle(ctx, {
      manager: this.manager,
      logger: options.logger,
      isManagedAgent: (agent) => this.isManagedAgent(agent),
      dynamicActivation: options.dynamicActivation,
      activationSkill: options.activationSkill,
    });
    if (
      options.activationPresets.length === 0 &&
      this.catalogTools.length > 0
    ) {
      options.logger.warn("qa-tools.unscoped", {
        hint: "tools.activationPresets is empty: any composed agent can unlock the QA tools",
      });
    }
  }

  /** Names currently registered on one agent; the admission guard reads this per call. */
  activeToolNames(agent: Agent): readonly string[] {
    return this.manager.activeToolNames(agent);
  }

  /** Shipped scope-local names, including entries not activated on an agent yet. */
  catalogToolNames(): readonly string[] {
    return this.catalogTools;
  }

  dispose(): void {
    this.detector.disposeListeners();
    this.lifecycle.dispose();
  }

  /**
   * The preset gate. An empty `activationPresets` leaves it open, which is only
   * coherent when this plugin serves a single agent composition; naming the QA
   * preset keeps an unrelated DSH agent from unlocking the same catalog by
   * loading a skill of the same name.
   */
  private isManagedAgent(agent: Agent): boolean {
    const presets = this.options.activationPresets;
    if (presets.length === 0) return true;
    const preset = agent.session?.header?.agentPreset;
    return preset !== undefined && presets.includes(preset);
  }
}
