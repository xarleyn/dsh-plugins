import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { QaAttestationError } from "./attestation.js";
import { qaToolDenial, qaToolPolicyPlan } from "./lockdown-policy.js";
import type { QaLockdownProof, ResolvedQaSurfaceConfig } from "./types.js";

interface AppliedPolicy {
  readonly fingerprint: string;
  readonly disposeGuard: () => void;
  readonly disposeRestriction: () => void;
}

/** Grace period in which a fresh session may still be pinned to the QA preset. */
const FRESH_SESSION_BOOTSTRAP_WINDOW_MS = 120_000;

/**
 * Host-side QA policy admission boundary — the only browser-callable operation
 * that turns a session into a locked QA session. It verifies the immutable
 * session composition against the effective deployment config, refuses to
 * adopt a non-QA session with user history, validates the named permission
 * preset, pins the scoped tool restriction plus the monotonic execution guard,
 * and returns a sanitized proof. Every refusal carries only a coarse reason.
 */
export class QaPolicyAdmission {
  private readonly appliedPolicies = new Map<Agent, AppliedPolicy>();

  constructor(
    private readonly ctx: Context,
    private readonly config: () => ResolvedQaSurfaceConfig,
    private readonly logger: PluginLogger,
  ) {
    ctx.on("agent/disposed", ({ agent }) => {
      this.appliedPolicies.delete(agent);
    });
  }

  secureSession(sessionId: string): QaLockdownProof {
    const config = this.config();
    const lockdown = config.lockdown;
    const agent = this.ctx.agents.get(SessionId(sessionId));
    if (agent === undefined) {
      throw new QaAttestationError("agent-unavailable", "agent is unavailable");
    }
    if (!lockdown.enabled) {
      return {
        sessionId,
        enabled: false,
        agentPresetMatches: true,
        workspaceMatches: true,
        modelMatches: true,
        sandboxIsReadOnly: false,
        approvalIsNever: false,
        permissionPreset: "",
        toolPolicyLoaded: false,
        toolAllowList: [],
      };
    }

    const expectedPreset = config.session.agentPreset;
    const agentPresetMatches =
      !lockdown.enforceFixedAgentPreset ||
      expectedPreset === null ||
      this.ctx.agentPresets.composedPreset(agent.ctx) === expectedPreset;

    const expectedWorkspace = config.session.workspaceId;
    const workspace =
      expectedWorkspace === null
        ? undefined
        : this.ctx.workspaceRegistry.get(WorkspaceId(expectedWorkspace));
    const workspaceMatches =
      !lockdown.enforceFixedWorkspace ||
      expectedWorkspace === null ||
      (workspace !== undefined && agent.session.header.cwd === workspace.path);

    const options = agent.options as Agent["options"] & {
      readonly reasoningEffort?: string;
    };
    const modelMatches =
      !lockdown.enforceFixedModel ||
      config.session.provider === null ||
      (options.provider === config.session.provider &&
        options.model === config.session.model &&
        (config.session.reasoningEffort === null ||
          options.reasoningEffort === config.session.reasoningEffort));

    if (!agentPresetMatches || !workspaceMatches || !modelMatches) {
      throw new QaAttestationError(
        "composition-mismatch",
        `composition mismatch: agent=${agentPresetMatches} workspace=${workspaceMatches} model=${modelMatches}`,
      );
    }

    const permission = this.ctx.permissionPresets.resolve(
      lockdown.permissionPreset,
    );
    if (
      permission.sandbox !== lockdown.sandboxMode ||
      permission.approval !== lockdown.approvalPolicy
    ) {
      throw new QaAttestationError(
        "permission-preset",
        `permission preset ${lockdown.permissionPreset} does not resolve to read-only/never`,
      );
    }

    const currentPermission = this.ctx.permissionPresets.current(
      agent.session.events,
    );
    const hasUserHistory = agent.session.events.some(
      (event) => event.type === "user/message",
    );
    if (
      currentPermission !== lockdown.permissionPreset &&
      (hasUserHistory ||
        Date.now() - agent.session.header.createdAt >
          FRESH_SESSION_BOOTSTRAP_WINDOW_MS)
    ) {
      throw new QaAttestationError(
        "adoption-refused",
        "existing non-QA session cannot be adopted",
      );
    }

    const policy = qaToolPolicyPlan(
      lockdown.toolPolicy.allow,
      (toolName) => this.ctx.tools.get(toolName, agent) !== undefined,
    );
    if (policy.unknown.length > 0) {
      throw new QaAttestationError(
        "unknown-tools",
        `unknown QA tool(s): ${policy.unknown.join(", ")}`,
      );
    }
    const fingerprint = JSON.stringify(policy.allow);
    const prior = this.appliedPolicies.get(agent);
    if (prior?.fingerprint !== fingerprint) {
      const allowed = new Set(policy.allow);
      const disposeGuard = agent.ctx.tools.guard((execution) =>
        qaToolDenial(allowed, execution.name),
      );
      try {
        const disposeRestriction = agent.ctx.tools.restrict({
          allow: policy.allow,
        });
        this.appliedPolicies.set(agent, {
          fingerprint,
          disposeGuard,
          disposeRestriction,
        });
        prior?.disposeRestriction();
        prior?.disposeGuard();
      } catch (error) {
        disposeGuard();
        throw error;
      }
    }

    this.ctx.permissionPresets.set(agent.session, lockdown.permissionPreset);
    const effectivePermission = this.ctx.permissionPresets.current(
      agent.session.events,
    );
    const sandboxIsReadOnly = permission.sandbox === "read-only";
    const approvalIsNever = permission.approval === "never";
    if (
      effectivePermission !== lockdown.permissionPreset ||
      !sandboxIsReadOnly ||
      !approvalIsNever
    ) {
      throw new QaAttestationError(
        "attestation-failed",
        "permission attestation failed",
      );
    }

    this.logger.debug("lockdown.attested", {
      sessionId,
      permissionPreset: lockdown.permissionPreset,
      toolAllowList: policy.allow,
    });
    return {
      sessionId,
      enabled: true,
      agentPresetMatches,
      workspaceMatches,
      modelMatches,
      sandboxIsReadOnly,
      approvalIsNever,
      permissionPreset: lockdown.permissionPreset,
      toolPolicyLoaded: true,
      toolAllowList: policy.allow,
    };
  }

  /** Detach every pinned tool policy; wired as a disposal effect by the entry. */
  dispose(): void {
    for (const policy of this.appliedPolicies.values()) {
      policy.disposeRestriction();
      policy.disposeGuard();
    }
    this.appliedPolicies.clear();
  }
}
