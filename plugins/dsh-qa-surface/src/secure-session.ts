import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-system-prompt";
// The `types` subpath keeps the client ISessions Context merge authoritative;
// the package root merges a conflicting host `sessions` service type.
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { QaAccountsError } from "./accounts/store.js";
import { QaAttestationError } from "./attestation.js";
import { qaToolDenial, qaToolPolicyPlan } from "./lockdown-policy.js";
import { QA_REPORT_SOURCES_TOOL } from "./provenance/host-store.js";
import type { QaLockdownProof, ResolvedQaSurfaceConfig } from "./types.js";
import { qaUserWorkspaceDenial } from "./user-workspace.js";

interface AppliedPolicy {
  readonly fingerprint: string;
  readonly disposeGuard: () => void;
  readonly disposeRestriction: () => void;
  readonly disposeGuidance: () => void;
}

/**
 * The accounts half of admission, resolved per call by the entry (accounts
 * may be toggled at runtime). A gate must either accept the token/session
 * pair or throw the coarse `QaAttestationError`; see {@link QaAccounts}.
 */
export interface QaAccountsGate {
  enforceSessionAccess(
    token: string,
    sessionId: string,
  ): { readonly id: string } | undefined;
  userWorkspace(userId: string, registeredWorkspacePath: string): string;
}

/** Grace period in which a fresh session may still be pinned to the QA preset. */
const FRESH_SESSION_BOOTSTRAP_WINDOW_MS = 120_000;

/**
 * Compare session cwds the way the host records them: separator- and
 * case-normalized on Windows, so a deployment path written with either
 * separator or case still matches the session header cwd.
 */
function cwdMatches(headerCwd: string | undefined, pinned: string): boolean {
  if (headerCwd === undefined) return false;
  const normalize = (value: string) =>
    value.replaceAll("\\", "/").replace(/\/+$/u, "");
  const left = normalize(headerCwd);
  const right = normalize(pinned);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

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
  private readonly workspaceRoots = new Map<string, string>();
  private readonly disposeWorkspaceGuard: () => void;

  constructor(
    private readonly ctx: Context,
    private readonly config: () => ResolvedQaSurfaceConfig,
    private readonly logger: PluginLogger,
    private readonly accounts?: QaAccountsGate,
  ) {
    this.disposeWorkspaceGuard = ctx.tools.guard((execution) => {
      const session = execution.agent?.session;
      if (session === undefined) return undefined;
      const root = this.workspaceRoots.get(String(session.id));
      if (root === undefined) return undefined;
      if (!cwdMatches(session.header.cwd, root)) {
        return "QA workspace boundary: session cwd is outside this user's directory.";
      }
      return qaUserWorkspaceDenial(execution, root);
    });
    ctx.on("session/created", (session) => {
      const parent = session.header.parentSession;
      if (parent === undefined) return;
      const root = this.workspaceRoots.get(String(parent));
      if (root !== undefined) this.workspaceRoots.set(String(session.id), root);
    });
    ctx.on("agent/disposed", ({ agent }) => {
      this.appliedPolicies.delete(agent);
      this.workspaceRoots.delete(String(agent.session.id));
    });
  }

  secureSession(token: string, sessionId: string): QaLockdownProof {
    const config = this.config();
    const lockdown = config.lockdown;
    // Account identity is checked before any policy work: an invalid token
    // must not learn whether a session exists or how the deployment composes.
    // Independent of lockdown — a deployment may gate users without pinning
    // the policy, and the gate itself no-ops while accounts are disabled.
    let sessionOwner: { readonly id: string } | undefined;
    if (this.accounts !== undefined) {
      try {
        sessionOwner = this.accounts.enforceSessionAccess(token, sessionId);
      } catch (error) {
        if (error instanceof QaAccountsError) {
          throw new QaAttestationError(
            error.reason === "session-owned-elsewhere"
              ? "session-owned-elsewhere"
              : "auth-required",
            error.message,
          );
        }
        throw error;
      }
    }
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
        sandboxModeMatches: false,
        approvalIsNever: false,
        permissionPreset: "",
        toolPolicyLoaded: false,
        toolAllowList: [],
      };
    }

    const expectedWorkspace = config.session.workspaceId;
    const pinnedWorkspace =
      expectedWorkspace === null
        ? undefined
        : this.ctx.workspaceRegistry.get(WorkspaceId(expectedWorkspace));
    // A pin that resolves to nothing would refuse the cwd comparison anyway,
    // but the precise reason saves an operator a round trip: the surface
    // stays closed until the workspace exists or the id is fixed.
    if (expectedWorkspace !== null && pinnedWorkspace === undefined) {
      throw new QaAttestationError(
        "workspace-unavailable",
        `workspace ${expectedWorkspace} is not registered`,
      );
    }
    let expectedUserRoot: string | undefined;
    if (config.accounts.perUserWorkspace) {
      if (sessionOwner === undefined || pinnedWorkspace === undefined) {
        throw new QaAttestationError(
          "workspace-unavailable",
          "per-user workspace identity is unavailable",
        );
      }
      try {
        expectedUserRoot = this.accounts?.userWorkspace(
          sessionOwner.id,
          pinnedWorkspace.path,
        );
      } catch (error) {
        throw new QaAttestationError(
          "workspace-unavailable",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const expectedPreset = config.session.agentPreset;
    const agentPresetMatches =
      !lockdown.enforceFixedAgentPreset ||
      expectedPreset === null ||
      this.ctx.agentPresets.composedPreset(agent.ctx) === expectedPreset;

    const workspaceMatches =
      !lockdown.enforceFixedWorkspace ||
      (expectedWorkspace === null && config.session.cwd === null) ||
      (expectedUserRoot !== undefined &&
        cwdMatches(agent.session.header.cwd, expectedUserRoot)) ||
      (!config.accounts.perUserWorkspace &&
        pinnedWorkspace !== undefined &&
        cwdMatches(agent.session.header.cwd, pinnedWorkspace.path)) ||
      (expectedWorkspace === null &&
        config.session.cwd !== null &&
        cwdMatches(agent.session.header.cwd, config.session.cwd));

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
        `permission preset ${lockdown.permissionPreset} does not resolve to ${lockdown.sandboxMode}/never`,
      );
    }

    const currentPermission = this.ctx.permissionPresets.current(agent.session);
    // History check over the model-visible surface: `user/message` is a
    // surface event, so any adopted conversation shows up here regardless of
    // window pagination.
    const hasUserHistory = agent.session.surface.nodes.some(
      (seq) => agent.session.eventAt(seq)?.type === "user/message",
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

    const policyAllow =
      config.sources.enabled &&
      config.sources.subagents.enableReportToolFallback &&
      !lockdown.toolPolicy.allow.includes(QA_REPORT_SOURCES_TOOL)
        ? [...lockdown.toolPolicy.allow, QA_REPORT_SOURCES_TOOL]
        : lockdown.toolPolicy.allow;
    const policy = qaToolPolicyPlan(
      policyAllow,
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
      const disposeGuidance = agent.ctx.systemPrompt.section({
        name: "dsh-qa-surface:structured-sources",
        order: 950,
        text: "Source provenance is collected automatically from tools. Do not append a manual Sources/Источники bibliography to the answer. Delegated providers that cannot expose tool events should call qa_report_sources before finishing.",
      });
      try {
        const disposeRestriction = agent.ctx.tools.restrict({
          allow: policy.allow,
        });
        this.appliedPolicies.set(agent, {
          fingerprint,
          disposeGuard,
          disposeRestriction,
          disposeGuidance,
        });
        prior?.disposeRestriction();
        prior?.disposeGuard();
        prior?.disposeGuidance();
      } catch (error) {
        disposeGuard();
        disposeGuidance();
        throw error;
      }
    }

    this.ctx.permissionPresets.set(agent.session, lockdown.permissionPreset);
    const effectivePermission = this.ctx.permissionPresets.current(
      agent.session,
    );
    const sandboxModeMatches = permission.sandbox === lockdown.sandboxMode;
    const approvalIsNever = permission.approval === "never";
    if (
      effectivePermission !== lockdown.permissionPreset ||
      !sandboxModeMatches ||
      !approvalIsNever
    ) {
      throw new QaAttestationError(
        "attestation-failed",
        "permission attestation failed",
      );
    }
    if (expectedUserRoot !== undefined) {
      this.workspaceRoots.set(sessionId, expectedUserRoot);
    } else {
      this.workspaceRoots.delete(sessionId);
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
      sandboxModeMatches,
      approvalIsNever,
      permissionPreset: lockdown.permissionPreset,
      toolPolicyLoaded: true,
      // The fallback reporter is an internal read-only provenance capability,
      // not an operator-configured QA tool grant.
      toolAllowList: lockdown.toolPolicy.allow,
    };
  }

  /** Detach every pinned tool policy; wired as a disposal effect by the entry. */
  dispose(): void {
    for (const policy of this.appliedPolicies.values()) {
      policy.disposeRestriction();
      policy.disposeGuard();
      policy.disposeGuidance();
    }
    this.appliedPolicies.clear();
    this.workspaceRoots.clear();
    this.disposeWorkspaceGuard();
  }
}
