import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
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
}

interface UserWorkspaceAccess {
  root: string;
  sharedReadOnlyRoots: readonly string[];
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
  /**
   * Sessions the QA surface has attested. The provenance note is written for
   * exactly these, and a delegated child resolves through its root session, so
   * one set answers for the whole chat.
   */
  private readonly attested = new Set<string>();
  private readonly workspaceAccess = new Map<string, UserWorkspaceAccess>();
  private readonly disposeWorkspaceGuard: () => void;

  constructor(
    private readonly ctx: Context,
    private readonly config: () => ResolvedQaSurfaceConfig,
    private readonly logger: PluginLogger,
    private readonly accounts?: QaAccountsGate,
    /**
     * Names the QA tool catalog attached to one agent after its activation
     * skill loaded. Read per execution, so a tool becomes callable exactly when
     * it is registered and stops being callable once the agent is disposed.
     */
    private readonly dynamicToolNames: (
      agent: Agent,
    ) => readonly string[] = () => [],
  ) {
    this.disposeWorkspaceGuard = ctx.tools.guard((execution) => {
      const session = execution.agent?.session;
      if (session === undefined) return undefined;
      const access = this.workspaceAccess.get(String(session.id));
      if (access === undefined) return undefined;
      if (!cwdMatches(session.header.cwd, access.root)) {
        return "QA workspace boundary: session cwd is outside this user's directory.";
      }
      return qaUserWorkspaceDenial(
        execution,
        access.root,
        this.attachmentRoot(),
        access,
      );
    });
    ctx.on("session/created", (session) => {
      const parent = session.header.parentSession;
      if (parent === undefined) return;
      const access = this.workspaceAccess.get(String(parent));
      if (access !== undefined) {
        this.workspaceAccess.set(String(session.id), access);
      }
    });
    ctx.on("agent/disposed", ({ agent }) => {
      this.appliedPolicies.delete(agent);
      this.workspaceAccess.delete(String(agent.session.id));
    });
  }

  /**
   * The mounted attachment store's verbatim root, when the backend exposes
   * one. It sits outside every workspace, so the per-user fence would
   * otherwise deny the model the exact file an upload produced and the prompt
   * points it at. A backend without a resolvable root simply keeps the fence
   * closed — attachments then only work where reads are not fenced per user.
   */
  private attachmentRoot(): string | undefined {
    const store = this.ctx.get("attachments") as
      { readonly root?: unknown } | undefined;
    return typeof store?.root === "string" ? store.root : undefined;
  }

  /**
   * The live agent for one session, resuming a Session the Host has not
   * materialized in this process.
   *
   * DSH builds an agent on demand: a session's journal opens straight from
   * persistence (`session/page` reads the durable log), and only Agent-bound
   * operations — a prompt, a model selection, renaming, an upload — resolve or
   * resume one. So a chat from an earlier Host run has a readable transcript
   * and no agent at all, and attestation, which pins the tool policy ON that
   * agent, is the first thing here that needs one. Refusing instead would make
   * every restored chat unopenable until something else in the Host happened
   * to wake it.
   *
   * The resume composes the session's OWN recorded preset — the same
   * composition a stock prompt would produce — so a session composed outside
   * the QA preset still lands on the mismatch refusals below ("composition
   * mismatch"), and the adoption and permission checks stay the gate.
   */
  private async liveAgent(sessionId: string): Promise<Agent> {
    const live = this.ctx.agents.get(SessionId(sessionId));
    if (live !== undefined) return live;
    try {
      const resolved = await this.ctx.sessionController.resolveAgent(
        SessionId(sessionId),
      );
      if (!("error" in resolved)) return resolved.agent;
      this.logger.error("session.agent-resolve-rejected", {
        sessionId,
        error: resolved.error.message,
      });
    } catch (error) {
      // Either the composition itself failed (a preset that no longer mounts,
      // a log the Host refuses to read) or the resolution threw before it
      // could classify itself. Both are the same coarse fact for the browser.
      this.logger.error("session.agent-resolve-rejected", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw new QaAttestationError("agent-unavailable", "agent is unavailable");
  }

  async secureSession(
    token: string,
    sessionId: string,
  ): Promise<QaLockdownProof> {
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
    const agent = await this.liveAgent(sessionId);
    this.attested.add(sessionId);
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
      const disposeGuard = agent.ctx.tools.guard((execution) => {
        const agent = execution.agent;
        return qaToolDenial(
          allowed,
          execution.name,
          agent === undefined ? [] : this.dynamicToolNames(agent),
        );
      });
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
      const currentAccess = this.workspaceAccess.get(sessionId);
      if (currentAccess === undefined) {
        this.workspaceAccess.set(sessionId, {
          root: expectedUserRoot,
          sharedReadOnlyRoots: lockdown.sharedReadOnlyRoots,
        });
      } else {
        // Children share this object, so a re-attestation also revokes stale
        // roots from already-running subagent sessions.
        currentAccess.root = expectedUserRoot;
        currentAccess.sharedReadOnlyRoots = lockdown.sharedReadOnlyRoots;
      }
    } else {
      this.workspaceAccess.delete(sessionId);
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

  /**
   * Whether one session went through this boundary. The provenance note is
   * written only for attested sessions, which is what keeps a deployment's
   * source rules out of unrelated chats served by the same process.
   */
  knowsSession(sessionId: string): boolean {
    return this.attested.has(sessionId);
  }

  /** Detach every pinned tool policy; wired as a disposal effect by the entry. */
  dispose(): void {
    for (const policy of this.appliedPolicies.values()) {
      policy.disposeRestriction();
      policy.disposeGuard();
    }
    this.appliedPolicies.clear();
    this.attested.clear();
    this.workspaceAccess.clear();
    this.disposeWorkspaceGuard();
  }
}
