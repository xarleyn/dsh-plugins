import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { QaToolActivationManager } from "./activation-manager.js";
import { sessionLoadedSkill } from "./durable-marker.js";

export interface QaToolActivationLifecycleOptions {
  readonly manager: QaToolActivationManager;
  readonly logger: PluginLogger;
  /** Whether this agent's composition participates in QA tool activation. */
  readonly isManagedAgent: (agent: Agent) => boolean;
  /**
   * `true` waits for the activation skill; `false` attaches the catalog to
   * every managed agent as soon as it is created.
   */
  readonly dynamicActivation: boolean;
  /** The skill name whose load unlocks the tools in dynamic mode. */
  readonly activationSkill: string;
}

/**
 * Owns the arrival and departure edges of one agent's QA tool surface.
 *
 * Arrival: in dynamic mode a resumed session is recognized by the durable
 * marker in its own log and gets its current catalog back before the first
 * model step, while a fresh session waits for the detector. In immediate mode
 * every managed agent is served at creation.
 *
 * Departure: the exact registrations this plugin made are unwound when the
 * agent is disposed, so an agent that leaves never leaves a scoped tool behind.
 */
export class QaToolActivationLifecycle {
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly ctx: Context,
    private readonly options: QaToolActivationLifecycleOptions,
  ) {
    this.disposers.push(
      ctx.on("agent/created", ({ agent }) => this.onAgentCreated(agent), {
        global: true,
      }),
      ctx.on("agent/disposed", ({ agent }) => this.onAgentDisposed(agent), {
        global: true,
      }),
    );
  }

  /**
   * Restore a resumed activation, or attach immediately in the compatibility
   * mode. A fresh managed session ends this handler inactive by design: the
   * tools arrive when the model loads the activation skill.
   */
  private onAgentCreated(agent: Agent): void {
    if (!this.options.isManagedAgent(agent)) return;
    if (!this.options.dynamicActivation) {
      this.attach(agent, "immediate");
      return;
    }
    if (!sessionLoadedSkill(agent.session, this.options.activationSkill))
      return;
    this.options.logger.info("qa-tools.restore-requested", {
      agentId: String(agent.id),
      sessionId: String(agent.session.id),
      skill: this.options.activationSkill,
    });
    this.attach(agent, "restore");
  }

  private attach(agent: Agent, origin: "restore" | "immediate"): void {
    const result = this.options.manager.activate(agent, origin);
    if (result.status === "activated" && origin === "restore") {
      this.options.logger.info("qa-tools.restored", {
        agentId: String(agent.id),
        tools: result.count,
      });
    }
  }

  private onAgentDisposed(agent: Agent): void {
    this.options.manager.disposeAgent(agent);
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
  }
}
