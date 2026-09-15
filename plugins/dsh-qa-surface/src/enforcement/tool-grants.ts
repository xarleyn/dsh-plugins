import type { Agent } from "@deepseek-ai/dsh-agent";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type {
  QaSkillActivationOrigin,
  QaSkillActivationRecord,
  QaSkillDescriptor,
} from "../types.js";

/** One live grant: the skill that asked for tools and what it actually got. */
export interface QaSkillGrant {
  readonly skillName: string;
  readonly origin: QaSkillActivationOrigin;
  readonly requestedTools: readonly string[];
  readonly grantedTools: readonly string[];
  readonly deniedTools: readonly string[];
  readonly activatedAt: string;
}

export type QaSkillActivationOutcome =
  | {
      readonly status: "activated";
      readonly grant: QaSkillGrant;
      /** Present when a best-effort skill had to give up a required tool. */
      readonly warning?: string;
    }
  | { readonly status: "rejected"; readonly reason: string };

export interface QaAgentToolGrantsOptions {
  readonly agent: Agent;
  /** Tools visible from the first model step; the restriction keeps admitting them. */
  readonly baseTools: readonly string[];
  /** Ceiling for grants, already narrowed to tools that exist right now. */
  readonly grantableTools: readonly string[];
  /** Normalized `metadata.qa-surface` of every discovered skill. */
  readonly descriptors: ReadonlyMap<string, QaSkillDescriptor>;
  readonly logger: PluginLogger;
  /** Append one attempt to the session record for later review. */
  readonly record?: (entry: QaSkillActivationRecord) => void;
}

function describe(tools: readonly string[]): string {
  return tools.map((tool) => `"${tool}"`).join(", ");
}

/**
 * The scoped tool policy of one live agent.
 *
 * Two independent layers enforce the same effective set. `restrict()` decides
 * what the model can see at the next step, and the admission's guard decides
 * what may actually run; a grant widens both, and only up to the ceiling the
 * subrole was configured with. A skill file can therefore ask for anything —
 * the intersection with the role ceiling is what it gets.
 *
 * A restriction may only name tools the scope inherits, so a grant is verified
 * by applying it: a name the registry refuses (agent-local, unregistered) is
 * dropped from the grant instead of breaking the session.
 */
export class QaAgentToolGrants {
  private readonly active = new Map<string, QaSkillGrant>();
  private readonly tools: Set<string>;
  private disposeRestriction: (() => void) | undefined;

  constructor(private readonly options: QaAgentToolGrantsOptions) {
    this.tools = new Set(options.baseTools);
    this.applyRestriction([...this.tools]);
  }

  /** Whether the model would see this tool right now. */
  effectiveTools(): ReadonlySet<string> {
    return this.tools;
  }

  /** Grants currently held, newest last; one entry per activated skill. */
  activeGrants(): readonly QaSkillGrant[] {
    return [...this.active.values()];
  }

  /**
   * Activate one skill's declared tool requirements.
   *
   * The whole operation is atomic from the caller's point of view: either the
   * grant is recorded and the restriction admits it, or nothing changed and
   * the reason is returned. A strict skill refuses the activation outright; a
   * best-effort one activates and reports what it had to give up.
   * @param skillName - the skill the agent asked to load.
   * @param origin - which activation path asked, for the session record.
   * @returns the outcome, including the model-facing reason on refusal.
   */
  activate(
    skillName: string,
    origin: QaSkillActivationOrigin,
  ): QaSkillActivationOutcome {
    const descriptor = this.options.descriptors.get(skillName);
    const requested = [...(descriptor?.requiredTools ?? [])];
    const candidates = requested.filter((tool) =>
      this.options.grantableTools.includes(tool),
    );
    const before = [...this.tools];
    const accepted: string[] = [];
    for (const tool of candidates) {
      if (this.tools.has(tool)) {
        accepted.push(tool);
        continue;
      }
      try {
        this.applyRestriction([...this.tools, tool]);
        this.tools.add(tool);
        accepted.push(tool);
      } catch {
        // The registry refused the name (unregistered or agent-local), so the
        // tool stays out of the grant rather than breaking the activation.
      }
    }
    const denied = requested.filter((tool) => !accepted.includes(tool));

    if (descriptor?.requireAll === true && denied.length > 0) {
      this.restore(before);
      const reason = `Skill "${skillName}" cannot be activated because required tool ${describe(
        denied,
      )} is unavailable for the current role.`;
      this.commit(skillName, origin, "rejected", requested, [], denied, reason);
      return { status: "rejected", reason };
    }

    const grant: QaSkillGrant = Object.freeze({
      skillName,
      origin,
      requestedTools: Object.freeze(requested),
      grantedTools: Object.freeze(accepted),
      deniedTools: Object.freeze(denied),
      activatedAt: new Date().toISOString(),
    });
    this.active.set(skillName, grant);
    this.options.logger.info("skill-grant.activated", {
      skill: skillName,
      origin,
      granted: accepted,
      denied,
    });
    this.commit(skillName, origin, "activated", requested, accepted, denied);
    const warning =
      denied.length === 0
        ? undefined
        : [
            "Skill loaded with limited capabilities.",
            "",
            "Unavailable required tools:",
            ...denied.map((tool) => `- ${tool}`),
          ].join("\n");
    return {
      status: "activated",
      grant,
      ...(warning === undefined ? {} : { warning }),
    };
  }

  /** Record an audience refusal; no tool state changes. */
  deny(
    skillName: string,
    origin: QaSkillActivationOrigin,
    reason: string,
  ): void {
    const descriptor = this.options.descriptors.get(skillName);
    this.commit(
      skillName,
      origin,
      "denied",
      descriptor?.requiredTools ?? [],
      [],
      descriptor?.requiredTools ?? [],
      reason,
    );
  }

  /** Lift the restriction this instance owns. Safe to call more than once. */
  dispose(): void {
    const dispose = this.disposeRestriction;
    this.disposeRestriction = undefined;
    this.active.clear();
    this.tools.clear();
    for (const tool of this.options.baseTools) this.tools.add(tool);
    dispose?.();
  }

  /**
   * Swap the scoped restriction, newest first.
   *
   * The new mask is installed before the previous one is lifted: restrictions
   * intersect, so lifting first would leave a window in which the agent is
   * unrestricted, and a rejected name would then leave it that way.
   */
  private applyRestriction(allow: readonly string[]): void {
    const next = this.options.agent.ctx.tools.restrict({ allow: [...allow] });
    const previous = this.disposeRestriction;
    this.disposeRestriction = next;
    previous?.();
  }

  private restore(before: readonly string[]): void {
    this.tools.clear();
    for (const tool of before) this.tools.add(tool);
    this.applyRestriction(before);
  }

  private commit(
    skillName: string,
    origin: QaSkillActivationOrigin,
    outcome: QaSkillActivationRecord["outcome"],
    requested: readonly string[],
    granted: readonly string[],
    denied: readonly string[],
    reason?: string,
  ): void {
    this.options.record?.(
      Object.freeze({
        timestamp: new Date().toISOString(),
        skillName,
        origin,
        outcome,
        requestedTools: Object.freeze([...requested]),
        grantedTools: Object.freeze([...granted]),
        deniedTools: Object.freeze([...denied]),
        ...(reason === undefined ? {} : { reason }),
      }),
    );
  }
}
