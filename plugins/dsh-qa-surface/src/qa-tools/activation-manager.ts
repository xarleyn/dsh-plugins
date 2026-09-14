import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { assertValidQaToolCatalog } from "./catalog.js";
import type {
  QaToolActivation,
  QaToolActivationOrigin,
  QaToolActivationResult,
  QaToolActivationState,
  QaToolDescriptor,
} from "./types.js";

/** The slice of one agent the manager reads; narrow so tests can fake it. */
interface ManagedAgent {
  readonly id: string;
  readonly ctx: { readonly tools: Pick<Context["tools"], "register"> };
  readonly session: { readonly id: unknown };
}

export interface QaToolActivationManagerOptions {
  /** Live catalog; read per activation so a reload sees the new set. */
  readonly catalog: readonly QaToolDescriptor[];
  readonly catalogVersion: string;
  readonly logger: PluginLogger;
}

/**
 * Per-agent runtime ownership of the QA tool registrations.
 *
 * One agent's tools exist only while that agent is live: activation registers
 * the whole catalog through the agent's own scoped context, and disposal
 * unwinds the exact disposers `tools.register()` returned. State is a WeakMap
 * keyed by the live agent, so nothing has to be keyed by id and a stale agent
 * can never be mistaken for a resumed one.
 */
export class QaToolActivationManager implements QaToolActivation {
  private readonly states = new WeakMap<Agent, QaToolActivationState>();

  constructor(private readonly options: QaToolActivationManagerOptions) {}

  /**
   * Register the whole catalog on one agent, all or nothing.
   *
   * A failed registration unwinds every tool this attempt registered and leaves
   * the agent inactive: a partially attached QA surface would be worse than
   * none, because the model would see a tool it cannot rely on.
   * @param agent - the live agent receiving the tools.
   * @param origin - why activation ran, for the operator log.
   * @returns the outcome; `failed` carries the original error for the caller to report.
   */
  activate(
    agent: Agent,
    origin: QaToolActivationOrigin,
  ): QaToolActivationResult {
    const current = this.states.get(agent);
    if (current !== undefined && current.status !== "inactive") {
      return { status: "already-active" };
    }

    const state: QaToolActivationState = {
      status: "activating",
      disposers: [],
    };
    this.states.set(agent, state);

    const catalog = this.options.catalog;
    let toolName = "(preflight)";
    try {
      assertValidQaToolCatalog(catalog);
      // Called through the loaded tools object: the registry method uses
      // `this` to pick the calling scope's layer.
      const tools = (agent as unknown as ManagedAgent).ctx.tools;
      for (const descriptor of catalog) {
        toolName = descriptor.definition.name;
        state.disposers.push(tools.register(descriptor.definition));
      }
      state.status = "active";
      state.catalogVersion = this.options.catalogVersion;
    } catch (error) {
      this.rollback(state);
      this.states.delete(agent);
      this.options.logger.error("qa-tools.activation-failed", {
        agentId: String(agent.id),
        origin,
        tool: toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: "failed", error };
    }

    this.options.logger.info("qa-tools.activated", {
      agentId: String(agent.id),
      origin,
      tools: state.disposers.length,
      catalog: this.options.catalogVersion,
    });
    return { status: "activated", count: state.disposers.length };
  }

  /** Whether this agent currently has the QA tools registered. */
  isActive(agent: Agent): boolean {
    return this.states.get(agent)?.status === "active";
  }

  /** Names registered on this agent; the admission guard evaluates this per call. */
  activeToolNames(agent: Agent): readonly string[] {
    if (!this.isActive(agent)) return [];
    return this.options.catalog.map((descriptor) => descriptor.definition.name);
  }

  /**
   * Unregister one agent's QA tools and forget its state. Safe to call more
   * than once, and safe for an agent that never activated.
   * @param agent - the agent whose registrations must be unwound.
   */
  disposeAgent(agent: Agent): void {
    const state = this.states.get(agent);
    if (state === undefined) return;
    this.rollback(state);
    this.states.delete(agent);
    this.options.logger.debug("qa-tools.disposed", {
      agentId: String(agent.id),
    });
  }

  /** Dispose in reverse registration order, containing individual failures. */
  private rollback(state: QaToolActivationState): void {
    state.status = "inactive";
    state.catalogVersion = undefined;
    for (const dispose of state.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        this.options.logger.warn("qa-tools.dispose-failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
