import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { QaToolActivationManager } from "./activation-manager.js";

/** The skill-loader tool whose successful result may unlock the QA tools. */
const SKILL_TOOL = "skill";

/** The canonical value `skill` returns: the loaded skill's identity. */
function loadedSkillName(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name : undefined;
}

export interface QaToolActivationDetectorOptions {
  readonly manager: QaToolActivationManager;
  readonly logger: PluginLogger;
  /** The exact skill name that unlocks the QA tools. */
  readonly activationSkill: string;
  /** Whether this agent's composition participates in QA tool activation. */
  readonly isManagedAgent: (agent: Agent) => boolean;
}

/**
 * Turns a successful QA skill load into an activation request.
 *
 * The trigger is the authoritative `tools/result` of the built-in `skill` tool,
 * not the model's attempt and not the rendered conversation text: a refused,
 * unknown, or cancelled skill load reaches this listener as an error result and
 * activates nothing.
 */
export class QaToolActivationDetector {
  private readonly dispose: () => void;

  constructor(
    private readonly ctx: Context,
    private readonly options: QaToolActivationDetectorOptions,
  ) {
    this.dispose = ctx.on(
      "tools/result",
      (exec, result) => {
        this.observe(exec, result);
      },
      { global: true },
    );
  }

  private observe(
    exec: { readonly agent?: Agent; readonly name: string },
    result: { readonly isError: boolean; readonly value?: unknown },
  ): void {
    if (exec.name !== SKILL_TOOL) return;
    if (result.isError) return;
    const agent = exec.agent;
    if (agent === undefined) return;
    if (!this.options.isManagedAgent(agent)) return;
    if (loadedSkillName(result.value) !== this.options.activationSkill) return;

    this.options.logger.info("qa-tools.activation-requested", {
      agentId: String(agent.id),
      skill: this.options.activationSkill,
    });
    // The skill result itself stays authoritative: a failed attachment is
    // reported here and never rewritten into a skill failure.
    this.options.manager.activate(agent, "skill");
  }

  disposeListeners(): void {
    this.dispose();
  }
}
