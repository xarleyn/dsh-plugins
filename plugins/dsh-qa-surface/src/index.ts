import { randomUUID } from "node:crypto";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import type {} from "@deepseek-ai/dsh-agent-presets";
import type {} from "@deepseek-ai/dsh-permission-presets";
import type {} from "@deepseek-ai/dsh-settings";
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-system-prompt";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type { Context } from "@deepseek-ai/cordis";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import { ConfigSchema, resolveConfig } from "./config.js";
import { createQaAccountRemotes } from "./account-remotes.js";
import type { QaAccountRemotes } from "./account-remotes.js";
import {
  createQaPersonalSkillRemotes,
  QaPersonalSkillsHost,
} from "./personal-skills/index.js";
import type { QaPersonalSkillRemotes } from "./personal-skills/index.js";
import { QaApprovalGate } from "./approvals.js";
import {
  QaAttestationError,
  qaAttestationFailureMessage,
} from "./attestation.js";
import { applyDocumentsEnvOverrides } from "./documents/config.js";
import {
  DocumentError,
  installDocumentSubsystem,
  type DocumentFetchSource,
  type DocumentSubsystem,
} from "./documents/index.js";
import { QaQuestionGate } from "./questions.js";
import { QaSessionOwnership } from "./session-ownership.js";
import { entryRedirectRow } from "./entry-redirect.js";
import { registerQaNavigationRoute } from "./host-route.js";
import { makeLaunchTokenSource } from "./launch-token.js";
import { QaIntegrationPrincipalBindings } from "./integration-principals.js";
import { QaPolicyAdmission } from "./secure-session.js";
import { QaAccessService } from "./access/service.js";
import { QaPromptNotes } from "./prompt-notes.js";
import { QaTools } from "./qa-tools/index.js";
import { QaProvenanceHost } from "./provenance/host-store.js";
import { FileQaProvenanceSnapshotStore } from "./provenance/snapshot-store.js";
import {
  readSourceFilePreview,
  QaSourcePreviewError,
} from "./provenance/file-preview.js";
import {
  existingQaUserWorkspace,
  prepareQaUserWorkspace,
} from "./user-workspace.js";
import type { QaTurnSources } from "./provenance/types.js";
import type {
  QaAccountProfileInput,
  QaAccountSession,
  QaAccountStartersInput,
  QaAccountUserPublic,
  QaApprovalDecision,
  QaClaimResult,
  QaLockdownProof,
  QaOwnershipEntry,
  QaPendingApproval,
  QaPendingQuestion,
  QaQuestionAnswerItem,
  QaSurfaceConfig,
  ResolvedQaSurfaceConfig,
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillRemoval,
  QaSkillSummary,
  QaSkillToolDescriptor,
  QaSkillValidation,
  QaSourceFilePreview,
  QaWhoamiResult,
  QaPrincipal,
  QaAccessAdminSnapshot,
  QaCapabilitySelection,
  QaCurrentAccess,
  QaSessionAccess,
  QaSubrole,
  QaUserAccess,
} from "./types.js";

/**
 * The slice of the harness web service this plugin uses. A deployment may
 * install no web provider at all, and the service arrives from a package this
 * plugin does not link, so the injected context is read structurally instead of
 * through a dependency the package would have to carry everywhere.
 */
interface WebFetchSeam {
  fetch(
    request: { readonly url: string },
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<DocumentFetchSource>>>;
}

export const name = "qa-surface";
export const inject = [
  "agents",
  "sessions",
  "agentPresets",
  "permissionPresets",
  "tools",
  "systemPrompt",
  "workspaceRegistry",
  "sessionController",
];
// One home for the namespace: the browser card binds to the same constant
// through `src/shared/settings.ts`, which avoids importing this module (and
// schemastery with it) into the page.
import { QA_SURFACE_SETTINGS_NAMESPACE } from "./shared/settings.js";
export { QA_SURFACE_SETTINGS_NAMESPACE };
export const Config = ConfigSchema;

declare module "@deepseek-ai/cordis" {
  interface Context {
    qaSurface: QaSurface;
  }
}

const CONFIGURATION_ERROR = "Assistant configuration is unavailable.";

/** The `(reason: <code>)` marker contract shared with the attestation path. */
const ACCOUNTS_REASON_MARKER = /\(reason: ([a-z-]+)\)/u;

/**
 * The preview refusal codes the browser branches on. `unavailable` covers a
 * disabled capability, a chat without a cwd and an unreadable file alike; the
 * panel tells the audience the file may be gone, which is true of all three.
 */
type QaSourcePreviewRefusal = "outside-roots" | "not-evidence" | "unavailable";

/** Fold a preview refusal into the shared reason marker. */
function sourcePreviewRefusal(reason: QaSourcePreviewRefusal): Error {
  return new Error(`QA source preview refused the request (reason: ${reason})`);
}

/** Host companion: validates config, owns the admission boundary and the route. */
export class QaSurface extends TypertRemoteService {
  static inject = inject;
  static Config = ConfigSchema;

  private source: () => QaSurfaceConfig;
  private readonly logger: PluginLogger;
  private readonly admission: QaPolicyAdmission;
  private readonly approvals: QaApprovalGate;
  private readonly userQuestions: QaQuestionGate;
  private readonly provenance: QaProvenanceHost;
  private readonly notes: QaPromptNotes;
  /** Assigned after the admission gate; that gate only reads it per execution. */
  private readonly tools!: QaTools;
  /** Account-remote bodies; the wire signatures stay on this class. */
  private readonly accountRemotes: QaAccountRemotes;
  /** Roles, assignments, discovery and immutable per-session capability sets. */
  private readonly access: QaAccessService;
  /** Personal skills: storage, the DSH provider and the manual-edit watcher. */
  private readonly personalSkills: QaPersonalSkillsHost;
  /** Personal-skill remote bodies; the wire signatures stay on this class. */
  private readonly skillRemotes: QaPersonalSkillRemotes;
  private readonly launchToken: ReturnType<typeof makeLaunchTokenSource>;
  /** Root session principals attested for their owner, never for admin viewing. */
  private readonly integrationPrincipals = new QaIntegrationPrincipalBindings();
  private webServer:
    Parameters<typeof registerQaNavigationRoute>[0] | undefined;
  /**
   * The web fetch service, resolved by inject. Only the fetch seam of it is
   * used, and only for `document_from_url`; absent until a deployment supplies
   * a web provider.
   */
  private web: WebFetchSeam | undefined;
  private disposeRoute: (() => void) | undefined;
  private routeKey: string | undefined;
  /**
   * The document subsystem: its own runtime and the four tool registrations.
   * Rebuilt when the document configuration changes and torn down while the
   * subsystem or the whole surface is disabled.
   */
  private documents: DocumentSubsystem | undefined;
  private documentsKey: string | undefined;

  constructor(ctx: Context, entry: QaSurfaceConfig = {}) {
    super(ctx, "qaSurface", { namespace: "qaSurface" });
    const resolvedEntry = resolveConfig(entry);
    this.source = () => resolvedEntry;
    this.logger = getPluginLogger({
      pluginId: "dsh-qa-surface",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    this.accountRemotes = createQaAccountRemotes({
      getConfig: () => this.getConfig(),
      logger: this.logger,
    });
    this.access = new QaAccessService(ctx, {
      accounts: () => this.accountRemotes.resolve(this.getConfig()),
      config: () => this.getConfig(),
      logger: this.logger,
      dynamicToolNames: () => this.tools?.catalogToolNames() ?? [],
    });
    this.personalSkills = new QaPersonalSkillsHost({
      ctx,
      getConfig: () => this.getConfig(),
      logger: this.logger,
    });
    this.skillRemotes = createQaPersonalSkillRemotes({
      getConfig: () => this.getConfig(),
      logger: this.logger,
      skills: this.personalSkills.service,
      accounts: this.accountRemotes,
    });
    this.admission = new QaPolicyAdmission(
      ctx,
      () => this.getConfig(),
      this.logger,
      // Identity half of admission; no-ops while accounts stay disabled.
      {
        enforceSessionAccess: (token, sessionId) => {
          return this.accountRemotes
            .resolve(this.getConfig())
            ?.ensureSessionAccess(token, sessionId);
        },
        userWorkspace: (userId, registeredWorkspacePath) =>
          existingQaUserWorkspace(registeredWorkspacePath, userId),
      },
      // Legacy account-free sessions retain the dynamic catalog behavior;
      // role-managed sessions authorize its known entries through the frozen
      // capability policy instead.
      (agent) => this.tools?.activeToolNames(agent) ?? [],
      (token, sessionId, agent) =>
        this.access.policyForSession(token, sessionId, agent),
      () => this.tools?.catalogToolNames() ?? [],
    );
    this.provenance = new QaProvenanceHost(
      ctx,
      () => this.getConfig(),
      new FileQaProvenanceSnapshotStore(),
      (error) =>
        this.logger.error("sources.persistence-failed", {
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    // The one place a composed gate's `ask` becomes a decision for an attested
    // chat: refused outright while approvals are blocked, parked for the
    // operator's answer while they are interactive. The question seam shares
    // the ownership map: one chat, one surface answering it.
    const ownership = new QaSessionOwnership((sessionId) =>
      this.admission.knowsSession(sessionId),
    );
    this.approvals = new QaApprovalGate(
      ctx,
      () => this.getConfig().interaction.approvals === "interactive",
      ownership,
      this.logger,
    );
    this.userQuestions = new QaQuestionGate(
      ctx,
      () => this.getConfig().interaction.questions === "interactive",
      ownership,
      this.logger,
    );
    this.approvals.install();
    this.userQuestions.install();
    // The identity note and the provenance rule ride the conversation as
    // durable context messages, delegated experts included: the QA preset's
    // complete persona closes the system prompt to plugins, the conversation
    // stays open.
    this.notes = new QaPromptNotes(ctx, {
      config: () => this.getConfig(),
      accounts: () => this.accountRemotes.resolve(this.getConfig()),
      isQaSession: (sessionId) => this.admission.knowsSession(sessionId),
      logger: this.logger,
    });
    // The /qa route hands cookie-less browsers to the one-time host token
    // exchange; the proxy in the deploy kit does the same and either alone
    // suffices. Resolved lazily and once per process; unavailable bridges
    // warn once and leave the old marker hand-off in place.
    this.launchToken = makeLaunchTokenSource(
      () =>
        (ctx as unknown as { get(service: string): unknown }).get(
          "connection",
        ) as { authenticatedUrl?(baseUrl: string): string } | undefined,
      (message) => this.logger.warn("entry.token-bridge", { message }),
    );
    ctx.effect(
      () => () => this.integrationPrincipals.clear(),
      "dsh-qa-surface.integration-principals",
    );
    ctx.effect(() => async () => this.logger.close(), "dsh-qa-surface.logger");
    ctx.effect(
      () => () => this.admission.dispose(),
      "dsh-qa-surface.lockdown-policies",
    );
    ctx.effect(
      () => () => this.approvals.dispose(),
      "dsh-qa-surface.approvals",
    );
    ctx.effect(
      () => () => this.userQuestions.dispose(),
      "dsh-qa-surface.user-questions",
    );
    ctx.effect(
      () => () => this.provenance.dispose(),
      "dsh-qa-surface.provenance",
    );
    ctx.effect(() => () => this.notes.dispose(), "dsh-qa-surface.prompt-notes");
    ctx.effect(
      () => () => this.personalSkills.dispose(),
      "dsh-qa-surface.personal-skills",
    );
    ctx.effect(
      () => () => {
        this.documents?.dispose();
        this.documents = undefined;
        this.documentsKey = undefined;
      },
      "dsh-qa-surface.documents",
    );
    // Registered here rather than from the settings callback alone, so a
    // deployment that never opens the settings page still gets the tools.
    this.refreshDocuments();
    // The QA tool catalog is attached per agent, never at boot: nothing here
    // reaches the model until a managed agent loads the activation skill.
    this.tools = new QaTools(ctx, {
      logger: this.logger,
      dynamicActivation: this.getConfig().tools.dynamicActivation,
      activationSkill: this.getConfig().tools.activationSkill,
      activationMode: this.getConfig().tools.activationMode,
      activationPresets: this.getConfig().tools.activationPresets,
    });
    ctx.effect(() => () => this.tools.dispose(), "dsh-qa-surface.qa-tools");
    // The root index gains one head script: non-loopback hostnames continue
    // into /qa, the loopback operator keeps the full harness UI.
    ctx.on("webserver/index-inject", (table) => {
      const row = entryRedirectRow(this.getConfig());
      if (row !== undefined) table.push(row);
    });
    ctx.inject(["settings"], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        QA_SURFACE_SETTINGS_NAMESPACE,
        ConfigSchema,
        entry,
        {
          setSource: (source) => {
            this.source = source;
          },
          onChange: () => {
            const config = this.getConfig();
            this.refreshRoute();
            this.refreshDocuments();
            this.logger.info("config.updated", {
              enabled: config.enabled,
              route: config.route.path,
              sessionPolicy: config.session.policy,
              documents: config.documents.enabled,
            });
          },
          validate: (value) => {
            resolveConfig(value);
          },
        },
      );
    });
    ctx.inject(["webServer"], (webContext) => {
      this.webServer = webContext.webServer;
      this.refreshRoute();
      webContext.effect(
        () => () => {
          this.disposeRoute?.();
          this.disposeRoute = undefined;
          this.routeKey = undefined;
          this.webServer = undefined;
        },
        "dsh-qa-surface.navigation-route",
      );
    });
    // The web provider (and with it the fetch rules, credentials and address
    // policy) is optional: `document_from_url` answers BACKEND_UNAVAILABLE when
    // no deployment supplies one. The reference is resolved per call, so a
    // provider that arrives late is picked up without rebuilding the tools.
    ctx.inject(["web"], (webContext) => {
      this.web = (webContext as unknown as { web?: WebFetchSeam }).web;
      webContext.effect(
        () => () => {
          this.web = undefined;
        },
        "dsh-qa-surface.web-fetch-source",
      );
    });
    this.logger.info("plugin.ready", {
      enabled: resolvedEntry.enabled,
      route: resolvedEntry.route.path,
      sessionPolicy: resolvedEntry.session.policy,
    });
  }

  /** Resolve browser authentication to the caller only; never accepts an id. */
  principalForToken(token: string): QaPrincipal | undefined {
    const accounts = this.accountRemotes.resolve(this.getConfig());
    if (accounts === undefined) return undefined;
    const result = accounts.whoami(token);
    return result.authenticated ? { userId: result.user.id } : undefined;
  }

  /** Resolve only a directly QA-owned root session; delegated children fail closed. */
  principalForSession(sessionId: string): QaPrincipal | undefined {
    const accounts = this.accountRemotes.resolve(this.getConfig());
    if (accounts === undefined) return undefined;
    const userId = accounts.ownerIdOf(sessionId);
    if (userId === undefined || accounts.identityOf(userId) === undefined) {
      return undefined;
    }
    return this.integrationPrincipals.resolve(sessionId, userId);
  }

  /** Admit tools that independently enforce the same QA principal boundary. */
  registerPrincipalScopedTools(names: readonly string[]): () => void {
    return this.admission.registerPrincipalScopedTools(names);
  }

  getConfig(): ResolvedQaSurfaceConfig {
    return resolveConfig(this.source());
  }

  /**
   * Self-service signup; the first account ever created becomes admin. The
   * display name derives from the email: the generated client enforces exact
   * wire arity, so an optional name parameter would still be required.
   */
  @Remote("accountsRegister")
  accountsRegister(email: string, password: string): QaAccountSession {
    return this.accountRemotes.register(email, password);
  }

  @Remote("accountsLogin")
  accountsLogin(email: string, password: string): QaAccountSession {
    return this.accountRemotes.login(email, password);
  }

  /** Identity probe; safe to call with an empty or expired token. */
  @Remote("accountsWhoami")
  accountsWhoami(token: string): QaWhoamiResult {
    return this.accountRemotes.whoami(token);
  }

  /** Migrate a browser's local chat index into server-side ownership. */
  @Remote("accountsClaimSessions")
  accountsClaimSessions(
    token: string,
    sessionIds: readonly string[],
  ): QaClaimResult {
    return this.accountRemotes.claimSessions(token, sessionIds);
  }

  /** The token user's owned session ids; the sidebar list authority. */
  @Remote("accountsOwnedSessions")
  accountsOwnedSessions(token: string): { readonly ids: readonly string[] } {
    return this.accountRemotes.ownedSessions(token);
  }

  /**
   * Every chat-ownership entry with owner display names; the cross-user view
   * admin browsers group the sidebar by. Ordinary accounts are refused with
   * the dedicated reason, anonymous ones with auth-required.
   */
  @Remote("accountsListOwnership")
  accountsListOwnership(token: string): {
    readonly entries: readonly QaOwnershipEntry[];
  } {
    return this.accountRemotes.listOwnership(token);
  }

  /**
   * Replace the caller's own self-declared profile. The token is the only
   * identity the wire carries: a browser can never name a profile but its own,
   * and the deployment's declared fields and length limits are enforced in the
   * store before anything is written.
   */
  @Remote("accountsUpdateProfile")
  accountsUpdateProfile(
    token: string,
    input: QaAccountProfileInput,
  ): QaAccountUserPublic {
    return this.accountRemotes.updateProfile(token, input);
  }

  /**
   * Replace the caller's own starter buttons. Same self-service contract as
   * the profile write: the token names the only editable account, and the
   * deployment's limits are enforced in the store before anything is written.
   */
  @Remote("accountsUpdateStarters")
  accountsUpdateStarters(
    token: string,
    input: QaAccountStartersInput,
  ): QaAccountUserPublic {
    return this.accountRemotes.updateStarters(token, input);
  }

  /**
   * Serve the effective QA configuration to the browser. The DSH gateway pins
   * settings RPCs to loopback, so a browser served over the LAN always sees
   * the settings namespace as unavailable; this method is the config channel
   * such a browser falls back to. It is read-only projection — the admission
   * boundary stays in {@link secureSession}.
   */
  @Remote("describe")
  describe(): ResolvedQaSurfaceConfig {
    return this.getConfig();
  }

  /**
   * Create a QA session from Host-owned inputs. With account workspaces on,
   * cwd is `<configured workspace>/.qa-users/<account UUID>` and the child is
   * intentionally not registered or attached as another DSH workspace.
   */
  @Remote("createSession")
  async createSession(
    token: string,
    subroleId: string | null,
    adminPreview: boolean,
  ): Promise<string> {
    const config = this.getConfig();
    if (config.session.policy === "fixed") {
      throw new Error("Fixed QA sessions cannot be created.");
    }
    const id = SessionId(`session-${randomUUID()}`);
    const accounts = this.accountRemotes.resolve(config);
    const owner =
      accounts === undefined
        ? undefined
        : this.accountRemotes.run(() =>
            this.access.reserveSession(
              token,
              String(id),
              subroleId,
              adminPreview,
            ),
          );
    let hostCreated = false;
    try {
      // Check deployment-only pins before creating a durable Host session.
      // Full admission below still verifies the composed agent and tool view.
      this.admission.preflightDeployment();
      let userCwd: string | undefined;
      if (config.accounts.perUserWorkspace) {
        const workspaceId = config.session.workspaceId;
        if (owner === undefined || workspaceId === null) {
          throw new Error(
            "Per-user QA workspace configuration is unavailable.",
          );
        }
        const workspace = this.ctx.workspaceRegistry.get(
          WorkspaceId(workspaceId),
        );
        if (workspace === undefined) {
          throw new Error(
            `Configured QA workspace ${workspaceId} is unavailable.`,
          );
        }
        userCwd = prepareQaUserWorkspace(workspace.path, owner.id);
      }

      const created = await this.ctx.sessionController.create({
        sessionId: id,
        ...(userCwd !== undefined
          ? { cwd: userCwd }
          : config.session.workspaceId !== null
            ? { workspaceId: WorkspaceId(config.session.workspaceId) }
            : config.session.cwd !== null
              ? { cwd: config.session.cwd }
              : {}),
        ...(config.session.agentPreset === null
          ? {}
          : { agentPreset: config.session.agentPreset }),
      });
      hostCreated = true;
      if (config.session.provider !== null && config.session.model !== null) {
        await this.ctx.sessionController.selectModel({
          sessionId: created.sessionId,
          provider: config.session.provider,
          model: config.session.model,
          ...(config.session.reasoningEffort === null
            ? {}
            : { reasoningEffort: config.session.reasoningEffort }),
        });
      }
      const sessionId = String(created.sessionId);
      await this.admission.secureSession(token, sessionId);
      this.integrationPrincipals.attest(
        sessionId,
        owner?.id,
        accounts?.ownerIdOf(sessionId),
      );
      return sessionId;
    } catch (error) {
      if (!hostCreated && owner !== undefined) {
        accounts?.releaseSessionReservation(owner.id, String(id));
      }
      this.logger.error("session.create-rejected", {
        sessionId: String(id),
        reason: error instanceof QaAttestationError ? error.reason : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        qaAttestationFailureMessage("Unable to create a QA session.", error),
        { cause: error },
      );
    }
  }

  /** The selector model for the signed-in user; admin grants are irrelevant. */
  @Remote("accessCurrent")
  accessCurrent(token: string): QaCurrentAccess {
    return this.accountRemotes.run(() => this.access.current(token));
  }

  /** The immutable role pinned to an existing session. */
  @Remote("accessSession")
  accessSession(token: string, sessionId: string): QaSessionAccess {
    return this.accountRemotes.run(
      () => this.access.session(token, sessionId),
      sessionId,
    );
  }

  /** Complete administrator projection; authorization is checked before discovery. */
  @Remote("accessAdminSnapshot")
  async accessAdminSnapshot(token: string): Promise<QaAccessAdminSnapshot> {
    try {
      return await this.access.adminSnapshot(token);
    } catch (error) {
      return this.accountRemotes.run(() => {
        throw error;
      });
    }
  }

  @Remote("accessCreateSubrole")
  accessCreateSubrole(token: string, input: QaSubrole): QaSubrole {
    return this.accountRemotes.run(() =>
      this.access.createSubrole(token, input),
    );
  }

  @Remote("accessUpdateSubrole")
  accessUpdateSubrole(token: string, id: string, input: QaSubrole): QaSubrole {
    return this.accountRemotes.run(() =>
      this.access.updateSubrole(token, id, input),
    );
  }

  @Remote("accessDeleteSubrole")
  accessDeleteSubrole(
    token: string,
    id: string,
    replacementId: string | null,
  ): { readonly deleted: boolean } {
    return this.accountRemotes.run(() => {
      this.access.deleteSubrole(token, id, replacementId);
      return { deleted: true };
    });
  }

  @Remote("accessUpdateCommon")
  accessUpdateCommon(
    token: string,
    input: QaCapabilitySelection,
  ): QaCapabilitySelection {
    return this.accountRemotes.run(() =>
      this.access.updateCommon(token, input),
    );
  }

  @Remote("accessUpdateAssignment")
  accessUpdateAssignment(
    token: string,
    userId: string,
    input: QaUserAccess,
  ): QaUserAccess {
    return this.accountRemotes.run(() =>
      this.access.updateAssignment(token, userId, input),
    );
  }

  /** Pin and attest the effective policy. The browser supplies identity only. */
  @Remote("secureSession")
  async secureSession(
    token: string,
    sessionId: string,
  ): Promise<QaLockdownProof> {
    try {
      const principal = this.principalForToken(token);
      const proof = await this.admission.secureSession(token, sessionId);
      const accounts = this.accountRemotes.resolve(this.getConfig());
      const ownerId = accounts?.ownerIdOf(sessionId);
      // Admin cross-user viewing is intentionally not credential delegation.
      this.integrationPrincipals.attest(sessionId, principal?.userId, ownerId);
      return proof;
    } catch (error) {
      this.integrationPrincipals.attest(sessionId, undefined, undefined);
      // The carrier empties error.details, so the coarse reason rides the
      // wire message for the browser console; the specific mismatch facts
      // stay in this log only.
      const reason =
        error instanceof QaAttestationError
          ? error.reason
          : (ACCOUNTS_REASON_MARKER.exec(
              error instanceof Error ? error.message : "",
            )?.at(1) ?? "attestation-failed");
      this.logger.error("lockdown.rejected", {
        sessionId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`${CONFIGURATION_ERROR} (reason: ${reason})`, {
        cause: error,
      });
    }
  }

  /** Return canonical Host snapshots from plugin-owned durable provenance. */
  @Remote("sources")
  async sources(
    token: string,
    sessionId: string,
  ): Promise<readonly QaTurnSources[]> {
    await this.admission.secureSession(token, sessionId);
    return this.provenance.bundles(sessionId);
  }

  /**
   * The tool calls of one chat that wait for the operator. Read-only: a
   * deployment with blocked approvals answers with an empty list.
   */
  @Remote("pendingApprovals")
  async pendingApprovals(
    token: string,
    sessionId: string,
  ): Promise<readonly QaPendingApproval[]> {
    await this.admission.secureSession(token, sessionId);
    return this.approvals.list(sessionId);
  }

  /**
   * Apply the operator's answer to one parked call. The id must belong to a
   * request of this chat; an answer that lost the race (the turn was stopped,
   * the agent went away) is refused with `false`.
   */
  @Remote("answerApproval")
  async answerApproval(
    token: string,
    sessionId: string,
    requestId: string,
    decision: QaApprovalDecision,
  ): Promise<boolean> {
    await this.admission.secureSession(token, sessionId);
    return this.approvals.answer(sessionId, requestId, decision);
  }

  /**
   * The questions of one chat that wait for the operator. Read-only: a
   * deployment with unsupported questions answers with an empty list.
   */
  @Remote("pendingQuestions")
  async pendingQuestions(
    token: string,
    sessionId: string,
  ): Promise<readonly QaPendingQuestion[]> {
    await this.admission.secureSession(token, sessionId);
    return this.userQuestions.list(sessionId);
  }

  /**
   * Apply the operator's answers to one parked question request. Every question
   * of the request must be present in `answers`; one the browser omits reads as
   * a skip.
   */
  @Remote("answerQuestion")
  async answerQuestion(
    token: string,
    sessionId: string,
    requestId: string,
    answers: readonly QaQuestionAnswerItem[],
  ): Promise<boolean> {
    await this.admission.secureSession(token, sessionId);
    return this.userQuestions.answer(sessionId, requestId, answers);
  }

  /** Close a parked question request without answering it. */
  @Remote("cancelQuestion")
  async cancelQuestion(
    token: string,
    sessionId: string,
    requestId: string,
  ): Promise<boolean> {
    await this.admission.secureSession(token, sessionId);
    return this.userQuestions.cancel(sessionId, requestId);
  }

  /**
   * Narrow read-only preview capability for files already present as sources.
   *
   * The readable roots mirror the per-user execution guard: the chat's own cwd
   * plus the deployment's shared read-only directories and the attachment
   * store. Without that mirroring a source the model was explicitly allowed to
   * read — the normal case for a deployment whose docs and code live beside
   * the per-account scratch directory — could never be opened in the panel.
   */
  @Remote("readSourceFile")
  async readSourceFile(
    token: string,
    sessionId: string,
    sourcePath: string,
  ): Promise<QaSourceFilePreview> {
    await this.admission.secureSession(token, sessionId);
    const config = this.getConfig();
    if (!config.sources.filePreview.enabled) {
      throw sourcePreviewRefusal("unavailable");
    }
    const agent = this.ctx.agents.get(
      (await import("@deepseek-ai/dsh-session/types")).SessionId(sessionId),
    );
    const cwd = agent?.session.header.cwd;
    if (cwd === undefined) throw sourcePreviewRefusal("unavailable");
    const attachmentRoot = this.admission.attachmentRoot();
    try {
      return await readSourceFilePreview({
        sourcePath,
        cwd,
        isEvidence: (canonicalPath) =>
          this.provenance.sourceAllowed(sessionId, canonicalPath),
        sharedReadOnlyRoots: config.lockdown.sharedReadOnlyRoots,
        ...(attachmentRoot === undefined ? {} : { attachmentRoot }),
        maxBytes: config.sources.filePreview.maxBytes,
        maxMarkdownRenderBytes:
          config.sources.filePreview.maxMarkdownRenderBytes,
      });
    } catch (error) {
      this.logger.debug("source.preview-refused", {
        sessionId,
        reason:
          error instanceof QaSourcePreviewError ? error.reason : "unavailable",
      });
      throw sourcePreviewRefusal(
        error instanceof QaSourcePreviewError ? error.reason : "unavailable",
      );
    }
  }

  /** Every personal skill of the token's account, sorted by name. */
  @Remote("skillsList")
  skillsList(token: string): { readonly skills: readonly QaSkillSummary[] } {
    return this.skillRemotes.list(token);
  }

  /** One personal skill with the body, its preserved frontmatter and revision. */
  @Remote("skillsGet")
  skillsGet(token: string, name: string): QaSkillDocument {
    return this.skillRemotes.get(token, name);
  }

  /** Create one skill directory below the account's own workspace. */
  @Remote("skillsCreate")
  skillsCreate(token: string, input: QaSkillDraftInput): QaSkillDocument {
    return this.skillRemotes.create(token, input);
  }

  /**
   * Replace one skill. `expectedRevision` is the revision the editor read; a
   * mismatch is refused rather than overwriting an edit made elsewhere.
   */
  @Remote("skillsUpdate")
  skillsUpdate(
    token: string,
    name: string,
    input: QaSkillDraftInput,
  ): QaSkillDocument {
    return this.skillRemotes.update(token, name, input);
  }

  /** Remove one skill into the account's own trash directory. */
  @Remote("skillsRemove")
  skillsRemove(
    token: string,
    name: string,
    expectedRevision: string | null,
  ): QaSkillRemoval {
    return this.skillRemotes.remove(token, name, expectedRevision);
  }

  /**
   * Check an unsaved draft: the file a save would write and the diagnostics
   * for it. `name` names the stored skill being edited, or null to create one.
   */
  @Remote("skillsValidate")
  skillsValidate(
    token: string,
    name: string | null,
    input: QaSkillDraftInput,
  ): QaSkillValidation {
    return this.skillRemotes.validate(token, name, input);
  }

  /**
   * The tool catalog the picker offers, with availability computed against
   * this deployment's QA scope. Declaring a tool here never grants it.
   */
  @Remote("skillsTools")
  skillsTools(token: string): {
    readonly tools: readonly QaSkillToolDescriptor[];
  } {
    return this.skillRemotes.tools(token);
  }

  private refreshRoute(): void {
    const config = this.getConfig();
    const key = config.enabled
      ? `${config.route.path}:${config.route.matchChildren}`
      : undefined;
    if (key === this.routeKey) return;
    this.disposeRoute?.();
    this.disposeRoute = undefined;
    this.routeKey = undefined;
    if (key === undefined || this.webServer === undefined) return;
    this.disposeRoute = registerQaNavigationRoute(this.webServer, config, {
      launchToken: this.launchToken,
    });
    this.routeKey = key;
  }

  /**
   * Install, rebuild or tear down the document subsystem. The raw entry is
   * resolved with the documented environment overrides applied, so a
   * deployment can point `QA_DOCLING_BASE_URL` at its own service without
   * touching the settings namespace; the settings layer stays authoritative
   * for everything it declares.
   */
  private refreshDocuments(): void {
    const config = this.getConfig();
    const enabled = config.enabled && config.documents.enabled;
    const key = enabled ? JSON.stringify(config.documents) : undefined;
    if (key === this.documentsKey) return;
    this.documents?.dispose();
    this.documents = undefined;
    this.documentsKey = key;
    if (key === undefined) return;
    this.documents = installDocumentSubsystem(this.ctx, {
      config: applyDocumentsEnvOverrides(
        this.source().documents ?? {},
        process.env,
      ),
      logger: this.logger,
      register: (definition) => this.ctx.tools.register(definition),
      fetchSource: async (url, signal) => {
        const web = this.web;
        if (web === undefined)
          throw new DocumentError(
            "BACKEND_UNAVAILABLE",
            "this deployment has no web fetch provider, so online sources cannot be read",
          );
        return await web.fetch({ url }, signal);
      },
    });
  }
}

export {
  ConfigSchema,
  DEFAULT_QA_SURFACE_CONFIG,
  normalizeRoutePath,
  resolveConfig,
} from "./config.js";
export { QaAttestationError } from "./attestation.js";
export type { QaAttestationReason } from "./attestation.js";
export { QaAccounts, QaAccountsError } from "./accounts/store.js";
export { entryRedirectRow, entryRedirectScript } from "./entry-redirect.js";
export { registerQaNavigationRoute } from "./host-route.js";
export { QaIntegrationPrincipalBindings } from "./integration-principals.js";
export { qaToolDenial, qaToolPolicyPlan } from "./lockdown-policy.js";
export * from "./documents/index.js";
export { QaPolicyAdmission } from "./secure-session.js";
export { QaAccessService } from "./access/service.js";
export { QaRoleRepository } from "./access/role-repository.js";
export {
  defaultCapabilityConfig,
  normalizeCapabilityConfig,
  normalizeUserAccess,
  resolveCapabilityPolicy,
} from "./access/model.js";
export {
  QaPromptNotes,
  renderUserIdentity,
  QA_IDENTITY_NOTE,
  QA_SOURCES_NOTE,
} from "./prompt-notes.js";
export * from "./provenance/index.js";
export type * from "./types.js";
export default QaSurface;
