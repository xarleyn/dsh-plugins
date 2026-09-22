import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
// The `types` subpath keeps the client ISessions Context merge authoritative;
// the package root merges a conflicting host `sessions` service type.
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type { DocumentsFace } from "@yadsh/dsh-documents";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import {
  QA_SESSION_CLAIM_WINDOW_MS,
  QaAccountsError,
  type QaSessionFacts,
} from "./accounts/store.js";
import { QaAttestationError } from "./attestation.js";
import {
  qaCeilingDenial,
  qaToolDenial,
  qaToolPolicyPlan,
} from "./lockdown-policy.js";
import type { QaResolvedSessionPolicy } from "./access/service.js";
import { installQaSkillPolicy } from "./enforcement/skill-policy.js";
import { installInheritableMask } from "./enforcement/tool-mask.js";
import { QA_REPORT_SOURCES_TOOL } from "./provenance/host-store.js";
import { QA_ASK_QUESTION_TOOL } from "./questions.js";
import type { QaLockdownProof, ResolvedQaSurfaceConfig } from "./types.js";
import { qaUserWorkspaceDenial } from "./user-workspace.js";

interface AppliedPolicy {
  readonly fingerprint: string;
  readonly disposeGuard: () => void;
  /** Owns the scoped restriction; disposed to lift the agent's tool mask. */
  readonly disposeTools: () => void;
  readonly disposeSkillPolicy: () => void;
}

interface UserWorkspaceAccess {
  root: string;
  sharedReadOnlyRoots: readonly string[];
}

/**
 * The slice of the document service this gate needs: the readable input roots
 * one session's `document_*` tools may carry. Resolved softly per grant, so a
 * Host that runs QA Surface without the document plugin simply grants nothing
 * — the tools are absent there rather than wrong. The method is optional for
 * the same reason: an older installed plugin has no such grant to give.
 */
type QaDocumentInputRoots = Pick<DocumentsFace, "registerInputRoots">;

interface QaDeploymentPins {
  readonly pinnedWorkspace?: { readonly path: string };
  readonly permission?: { readonly sandbox: string; readonly approval: string };
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
    facts?: QaSessionFacts,
  ): { readonly id: string } | undefined;
  userWorkspace(userId: string, registeredWorkspacePath: string): string;
  /**
   * The account an ownership record names, for callers that authenticated by
   * another credential (the integration API's service token). Absent records
   * and a changed owner both resolve to undefined. Only read by that path: the
   * token-shaped entry above remains the browser's only door.
   */
  ownerIdOf(sessionId: string): string | undefined;
}

/**
 * Grace period in which a fresh session may still be pinned to the QA preset
 * (and, in the accounts store, claimed by whoever attests it first). One
 * number on purpose: the adoption rule and the auto-claim rule must describe
 * the same notion of "fresh".
 */
const FRESH_SESSION_BOOTSTRAP_WINDOW_MS = QA_SESSION_CLAIM_WINDOW_MS;

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
  /** Host-trusted principal-scoped plugin tools enabled outside static config. */
  private readonly principalScopedTools = new Set<string>();
  /**
   * Sessions the QA surface has attested. The provenance note is written for
   * exactly these, and a delegated child resolves through its root session, so
   * one set answers for the whole chat.
   */
  private readonly attested = new Set<string>();
  private readonly workspaceAccess = new Map<string, UserWorkspaceAccess>();
  /**
   * Removers of the document input roots granted per session, so a grant lives
   * exactly as long as the workspace access that justified it.
   */
  private readonly documentInputRoots = new Map<string, () => void>();
  /**
   * Every name reachable anywhere in one QA conversation, keyed by session id.
   *
   * The chat's agent and the agents delegated from it share one entry —
   * children inherit it when their session is created — because the ceiling is
   * a property of the conversation, not of one scope. See
   * {@link qaCeilingDenial} for why a scoped restriction cannot express it.
   */
  private readonly ceilings = new Map<string, ReadonlySet<string>>();
  private readonly disposeWorkspaceGuard: () => void;
  private readonly disposeCeilingGuard: () => void;

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
    /** Resolve and freeze the session's subrole policy after its agent exists. */
    private readonly capabilityPolicy?: (
      owner: { readonly id: string } | undefined,
      sessionId: string,
      agent: Agent,
    ) => Promise<QaResolvedSessionPolicy | undefined>,
    /** Scope-local catalog entries may be known before they are activated. */
    private readonly knownDynamicToolNames: () => readonly string[] = () => [],
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
    // The workspace guard above covers the chat's own agents; this one covers
    // every agent of the conversation, delegated children included. They are
    // composed from the preset rather than from the parent agent, so no scoped
    // restriction reaches them and their preset `toolFilter` would otherwise be
    // their whole boundary (see {@link qaCeilingDenial}).
    this.disposeCeilingGuard = ctx.tools.guard((execution) => {
      const session = execution.agent?.session;
      if (session === undefined) return undefined;
      const ceiling = this.ceilings.get(String(session.id));
      if (ceiling === undefined) return undefined;
      return qaCeilingDenial(ceiling, execution.name);
    });
    ctx.on("session/created", (session) => {
      const parent = session.header.parentSession;
      if (parent === undefined) return;
      const access = this.workspaceAccess.get(String(parent));
      if (access !== undefined) {
        this.workspaceAccess.set(String(session.id), access);
        // A delegated child runs the same tools against the same store, so it
        // inherits the grant the way it inherits the fence.
        this.grantDocumentInputRoots(String(session.id));
      }
      // A child inherits the conversation's ceiling, and a grandchild inherits
      // it through the child, so one lookup answers for any depth.
      const ceiling = this.ceilings.get(String(parent));
      if (ceiling !== undefined) {
        this.ceilings.set(String(session.id), ceiling);
      }
    });
    ctx.on("agent/disposed", ({ agent }) => {
      this.appliedPolicies.delete(agent);
      this.workspaceAccess.delete(String(agent.session.id));
      this.ceilings.delete(String(agent.session.id));
      this.revokeDocumentInputRoots(String(agent.session.id));
    });
  }

  /**
   * Add tools whose own executor resolves the QA principal server-side.
   * Enabling the contributing plugin is the operator decision; model arguments
   * still cannot select an owner. The returned disposer mirrors tool lifetime.
   */
  registerPrincipalScopedTools(names: readonly string[]): () => void {
    const normalized = names.map((name) => name.trim()).filter(Boolean);
    for (const name of normalized) this.principalScopedTools.add(name);
    return () => {
      for (const name of normalized) this.principalScopedTools.delete(name);
    };
  }

  /**
   * Validate deployment-owned facts before a Host session is materialized.
   * Agent-scoped facts (preset composition and tools) remain in secureSession,
   * but a missing Workspace or mismatched permission preset must not leave a
   * newly-created, permanently unusable chat behind.
   */
  preflightDeployment(): void {
    this.deploymentPins(this.config());
  }

  /**
   * The mounted attachment store's verbatim root, when the backend exposes
   * one. It sits outside every workspace, so the per-user fence would
   * otherwise deny the model the exact file an upload produced and the prompt
   * points it at. A backend without a resolvable root simply keeps the fence
   * closed — attachments then only work where reads are not fenced per user.
   * Source preview asks for the same root, so one upload is readable by both.
   */
  attachmentRoot(): string | undefined {
    const store = this.ctx.get("attachments") as
      { readonly root?: unknown } | undefined;
    return typeof store?.root === "string" ? store.root : undefined;
  }

  /**
   * Carry the fence's attachment exemption into the document pipeline.
   *
   * The guard above lets a single-file read reach the mounted store: an upload
   * is content-addressed, immutable, outside every workspace, and the prompt
   * hands the model exactly that path. The document pipeline keeps its own
   * read scope and knew nothing about the store, so `document_*` refused the
   * very file the model was allowed to read — the panel's own Word preview hit
   * the same wall. The grant is the missing hand-over, made where the access it
   * mirrors is made: per admitted session, and revoked with it.
   */
  private grantDocumentInputRoots(sessionId: string): void {
    const root = this.attachmentRoot();
    if (root === undefined || this.documentInputRoots.has(sessionId)) return;
    const documents = this.ctx.get("documents") as
      Partial<QaDocumentInputRoots> | undefined;
    const remove = documents?.registerInputRoots?.(sessionId, [root]);
    if (remove === undefined) {
      this.logger.debug("documents.input-roots-unavailable", { sessionId });
      return;
    }
    this.documentInputRoots.set(sessionId, remove);
  }

  /** Drop one session's document grant, if the pipeline still holds it. */
  private revokeDocumentInputRoots(sessionId: string): void {
    const remove = this.documentInputRoots.get(sessionId);
    if (remove === undefined) return;
    this.documentInputRoots.delete(sessionId);
    remove();
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

  /**
   * The Host-registered facts of one session, for the accounts gate's bounded
   * auto-claim. A session this process has not materialized (a chat of an
   * earlier Host run, reached before its agent exists) yields no facts and
   * keeps the historical unbounded claim.
   */
  private sessionFacts(sessionId: string): QaSessionFacts {
    const registry = (
      this.ctx as {
        sessions?: {
          get(id: SessionId):
            | {
                readonly header: {
                  readonly createdAt?: number;
                  readonly parentSession?: unknown;
                };
              }
            | undefined;
        };
      }
    ).sessions;
    const header = registry?.get(SessionId(sessionId))?.header;
    if (header === undefined) return {};
    return {
      ...(header.createdAt === undefined
        ? {}
        : { createdAt: header.createdAt }),
      ...(header.parentSession === undefined ? {} : { hasParent: true }),
    };
  }

  /**
   * Account identity and ownership are checked before any policy work: an
   * invalid token must not learn whether a session exists or how the
   * deployment composes. Independent of lockdown — a deployment may gate
   * users without pinning the policy, and the gate itself no-ops while
   * accounts are disabled.
   */
  private accessOwner(
    token: string,
    sessionId: string,
  ): { readonly id: string } | undefined {
    if (this.accounts === undefined) return undefined;
    try {
      return this.accounts.enforceSessionAccess(
        token,
        sessionId,
        this.sessionFacts(sessionId),
      );
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

  async secureSession(
    token: string,
    sessionId: string,
  ): Promise<QaLockdownProof> {
    return this.secureSessionAs((id) => this.accessOwner(token, id), sessionId);
  }

  /**
   * The same admission for a caller whose account was already authenticated by
   * another credential — the integration API, which has a service token and no
   * browser session.
   *
   * Everything after identity is shared with {@link secureSession}: the
   * policy pins, the tool allow-list, the QA tool attachment and the
   * attestation record are one code path, because a second copy of admission
   * would be a second place for a QA chat to be admitted without them.
   *
   * @param userId - the account the credential resolved to.
   * @param sessionId - the session to attest.
   * @returns the sanitized proof, as the browser path receives it.
   */
  async secureSessionForUser(
    userId: string,
    sessionId: string,
  ): Promise<QaLockdownProof> {
    return this.secureSessionAs(
      () => this.ownerById(userId, sessionId),
      sessionId,
    );
  }

  /**
   * The account behind one session, taken from the ownership record rather
   * than from a token. The record is the same authority the token path reads:
   * a chat belongs to exactly one account, and a service token may only ever
   * reach the chats of its own.
   */
  private ownerById(
    userId: string,
    sessionId: string,
  ): { readonly id: string } | undefined {
    if (this.accounts === undefined) return undefined;
    const ownerId = this.accounts.ownerIdOf(sessionId);
    if (ownerId !== userId) {
      throw new QaAttestationError(
        "session-owned-elsewhere",
        "this session is not owned by the authenticated account",
      );
    }
    return { id: ownerId };
  }

  private async secureSessionAs(
    resolveOwner: (sessionId: string) => { readonly id: string } | undefined,
    sessionId: string,
  ): Promise<QaLockdownProof> {
    const config = this.config();
    const lockdown = config.lockdown;
    let sessionOwner = resolveOwner(sessionId);
    const agent = await this.liveAgent(sessionId);
    // A delegated subagent session is an implementation detail of one answer
    // of its parent chat: it has no QA owner, and its sources reach the
    // parent through the provenance inheritance flow. Attesting it from the
    // browser would pin a capability policy onto a conversation nobody can
    // open, name or review, so it is refused whatever the lockdown state is.
    if (agent.session.header.parentSession !== undefined) {
      this.logger.warn("lockdown.subagent-attestation-refused", { sessionId });
      throw new QaAttestationError(
        "adoption-refused",
        "a delegated subagent session cannot be attested",
      );
    }
    if (this.accounts !== undefined) {
      // The first check ran before the session was materialized, when its
      // header could still be unknown — a delegated child from a previous
      // run is then indistinguishable from a fresh chat, and the store had
      // to leave the ownership claim deferred. Re-run it now that the
      // header is known, so ownership is recorded only for a session that
      // survived the refusal above.
      sessionOwner = resolveOwner(sessionId);
    }
    const pins = this.deploymentPins(config);
    if (!lockdown.enabled) {
      this.attested.add(sessionId);
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
    const pinnedWorkspace = pins.pinnedWorkspace;
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

    const permission = pins.permission!;

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

    // Resolve and persist a role snapshot only after every Host-owned
    // composition and adoption check passed. A browser cannot make a
    // foreign/non-QA agent leave behind a trusted capability record by merely
    // asking to attest it.
    const capability = await this.capabilityPolicy?.(
      sessionOwner,
      sessionId,
      agent,
    );

    const basePolicyAllow =
      capability?.policy.tools ?? lockdown.toolPolicy.allow;
    // One mount test for the whole policy: a name that is neither visible to
    // this agent nor declared by the QA catalog is refused below, so nothing
    // may be added to the list without passing it.
    const isMounted = (toolName: string): boolean =>
      this.ctx.tools.get(toolName, agent) !== undefined ||
      this.knownDynamicToolNames().includes(toolName);
    // The provenance reporter is this plugin's own tool, mounted only while the
    // deployment runs the sources fallback. Naming it in a deployment that does
    // not mount it would refuse every chat instead of degrading that fallback,
    // so the append is gated on the mount test like every configured name.
    const reportToolMissing =
      config.sources.enabled &&
      config.sources.subagents.enableReportToolFallback &&
      !basePolicyAllow.includes(QA_REPORT_SOURCES_TOOL) &&
      !isMounted(QA_REPORT_SOURCES_TOOL);
    if (reportToolMissing) {
      this.logger.warn("sources.report-tool-unmounted", {
        sessionId,
        tool: QA_REPORT_SOURCES_TOOL,
      });
    }
    const configuredPolicyAllow =
      config.sources.enabled &&
      config.sources.subagents.enableReportToolFallback &&
      !reportToolMissing &&
      !basePolicyAllow.includes(QA_REPORT_SOURCES_TOOL)
        ? [...basePolicyAllow, QA_REPORT_SOURCES_TOOL]
        : basePolicyAllow;
    // Principal-bound integrations were historically appended to the global
    // allow-list. Once capability policies are active they must be selected by
    // the role like every other tool; their own principal checks remain a
    // second, independent boundary.
    const policyAllow = [
      ...new Set([
        ...configuredPolicyAllow,
        ...(capability === undefined ? this.principalScopedTools : []),
      ]),
    ];
    const policy = qaToolPolicyPlan(policyAllow, isMounted);
    if (policy.unknown.length > 0) {
      throw new QaAttestationError(
        "unknown-tools",
        `unknown QA tool(s): ${policy.unknown.join(", ")}`,
      );
    }
    // Questions are answered in the QA view only while the deployment asks for
    // them, and only for a tool the attested session may actually call. Each
    // half can be satisfied while the other is not — the model then has a way
    // to ask that nobody answers, or a form nothing can raise — and neither is
    // fatal, because the seam refuses the ask with a reason the model can act
    // on. The mismatch is a warning on the operator's log rather than a
    // refusal of the chat.
    const questionsInteractive = config.interaction.questions === "interactive";
    const questionToolAllowed = policy.allow.includes(QA_ASK_QUESTION_TOOL);
    if (questionsInteractive && !questionToolAllowed) {
      this.logger.warn("question.config-incomplete", {
        sessionId,
        tool: QA_ASK_QUESTION_TOOL,
        reason: "not-allowed",
      });
    } else if (!questionsInteractive && questionToolAllowed) {
      this.logger.warn("question.config-incomplete", {
        sessionId,
        tool: QA_ASK_QUESTION_TOOL,
        reason: "unsupported",
      });
    }
    const fingerprint = JSON.stringify([
      policy.allow,
      capability?.policy.skills ?? [],
      capability?.policy.grantableTools ?? [],
    ]);
    const prior = this.appliedPolicies.get(agent);
    if (prior?.fingerprint !== fingerprint) {
      const allowed = new Set(policy.allow);
      // A capability policy owns the scoped restriction, because activating a
      // skill has to widen it later. The account-free path keeps the static
      // mask it has always used.
      const grants = capability?.createGrants();
      let disposeTools: () => void = () => undefined;
      let disposeGuard: () => void = () => undefined;
      let disposeSkillPolicy: () => void = () => undefined;
      try {
        disposeTools =
          grants === undefined
            ? this.maskAgentTools(agent, policy.allow, sessionId)
            : () => grants.dispose();
        disposeGuard = agent.ctx.tools.guard((execution) => {
          const subject = execution.agent;
          // A catalogue tool rides on the agent itself: no role list carries it
          // and the mask cannot name it, so reading it here is what makes it
          // callable — in a role-bound chat exactly as in an account-free one.
          // A name the catalogue did not attach is still the role's to allow.
          return qaToolDenial(
            grants?.effectiveTools() ?? allowed,
            execution.name,
            subject === undefined ? [] : this.dynamicToolNames(subject),
          );
        });
        // The conversation's ceiling, which also bounds the agents delegated
        // from this chat. A subrole reaches its own tools and the ones a skill
        // may grant it — never further — so an expert that names a tool in its
        // preset filter still cannot hold what the role cannot grant. The
        // session's own policy list rides along for the names the admission
        // appends to it (the provenance reporter), which a role does not list.
        //
        // The catalog's names ride along for the same reason: they are attached
        // to the agent by this plugin's own activation, and the grants admit
        // them for as long as the policy holds. A ceiling that omitted them
        // would deny every call to a tool the chat both owns and can see — the
        // documentation readers among them — and the refusal would name a
        // capability profile the caller cannot see the gap in.
        this.ceilings.set(
          sessionId,
          new Set([
            ...policy.allow,
            ...(capability === undefined
              ? this.principalScopedTools
              : [
                  ...capability.policy.tools,
                  ...capability.policy.grantableTools,
                ]),
            ...this.knownDynamicToolNames(),
          ]),
        );
        // A role snapshot cannot change for this session, but a restarted Host
        // materializes a new Agent and therefore a fresh scoped loader.
        prior?.disposeSkillPolicy();
        if (capability !== undefined && grants !== undefined) {
          disposeSkillPolicy = installQaSkillPolicy({
            agent,
            policy: capability.policy,
            discovered: capability.skills,
            grants,
            logger: this.logger,
            preview: capability.adminPreview,
          });
        }
        this.appliedPolicies.set(agent, {
          fingerprint,
          disposeGuard,
          disposeTools,
          disposeSkillPolicy,
        });
        prior?.disposeTools();
        prior?.disposeGuard();
      } catch (error) {
        disposeSkillPolicy();
        disposeTools();
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
      this.grantDocumentInputRoots(sessionId);
    } else {
      this.workspaceAccess.delete(sessionId);
      this.revokeDocumentInputRoots(sessionId);
    }

    this.attested.add(sessionId);
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
      // The deployment's pinned list, not this session's effective one: the
      // browser answers this proof against the lockdown config it holds, and a
      // subrole narrows that list — or the plugin adds its own internals to it —
      // without changing the config either side treats as the contract.
      toolAllowList: lockdown.toolPolicy.allow,
    };
  }

  /**
   * Mask one agent down to the policy's tool names, for the account-free path
   * (a capability policy installs its own mask through its grants).
   *
   * The mask admits what the scope inherits — the global layer and the ancestor
   * layers, which is where a preset's own tool rows live — and skips the names
   * the QA catalog registers on the agent, since a restriction cannot name
   * those. A name that is neither, or that the registry refuses for any other
   * reason, is left out of the mask and reported instead of failing the chat:
   * the guard below still denies it, so the effective set is unchanged.
   */
  private maskAgentTools(
    agent: Agent,
    allow: readonly string[],
    sessionId: string,
  ): () => void {
    const mask = installInheritableMask(
      agent.ctx.tools,
      allow,
      new Set(this.knownDynamicToolNames()),
    );
    if (mask.refused.length > 0) {
      this.logger.warn("lockdown.tool-mask-incomplete", {
        sessionId,
        dropped: mask.refused,
      });
    }
    return mask.dispose;
  }

  /** Resolve the deployment facts shared by creation and full attestation. */
  private deploymentPins(config: ResolvedQaSurfaceConfig): QaDeploymentPins {
    if (!config.lockdown.enabled) return {};

    const expectedWorkspace = config.session.workspaceId;
    const pinnedWorkspace =
      expectedWorkspace === null
        ? undefined
        : this.ctx.workspaceRegistry.get(WorkspaceId(expectedWorkspace));
    if (expectedWorkspace !== null && pinnedWorkspace === undefined) {
      throw new QaAttestationError(
        "workspace-unavailable",
        `workspace ${expectedWorkspace} is not registered`,
      );
    }

    let permission: QaDeploymentPins["permission"];
    try {
      permission = this.ctx.permissionPresets.resolve(
        config.lockdown.permissionPreset,
      );
    } catch (error) {
      throw new QaAttestationError(
        "permission-preset",
        `permission preset ${config.lockdown.permissionPreset} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      permission.sandbox !== config.lockdown.sandboxMode ||
      permission.approval !== config.lockdown.approvalPolicy
    ) {
      throw new QaAttestationError(
        "permission-preset",
        `permission preset ${config.lockdown.permissionPreset} does not resolve to ${config.lockdown.sandboxMode}/${config.lockdown.approvalPolicy}`,
      );
    }
    return pinnedWorkspace === undefined
      ? { permission }
      : { pinnedWorkspace, permission };
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
      policy.disposeSkillPolicy();
      policy.disposeTools();
      policy.disposeGuard();
    }
    this.appliedPolicies.clear();
    this.attested.clear();
    this.workspaceAccess.clear();
    for (const remove of this.documentInputRoots.values()) remove();
    this.documentInputRoots.clear();
    this.ceilings.clear();
    this.principalScopedTools.clear();
    this.disposeWorkspaceGuard();
    this.disposeCeilingGuard();
  }
}
