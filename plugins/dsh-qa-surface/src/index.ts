import { randomUUID } from "node:crypto";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import type {} from "@deepseek-ai/dsh-agent-presets";
import type {} from "@deepseek-ai/dsh-permission-presets";
import type {} from "@deepseek-ai/dsh-settings";
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-system-prompt";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ScopeKey } from "@deepseek-ai/dsh-scope";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type { Context } from "@deepseek-ai/cordis";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import { ConfigSchema, qaSurfaceVersion, resolveConfig } from "./config.js";
import { createQaAccountRemotes } from "./account-remotes.js";
import type { QaAccountRemotes } from "./account-remotes.js";
import { QaAdminService } from "./admin/service.js";
import { QaQualityStore } from "./admin/quality-store.js";
import {
  createSessionEraser,
  createSessionLogReader,
} from "./admin/session-log.js";
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
import { QaFileDeleteGate } from "./qa-tools/file-delete-gate.js";
import { QaQuestionGate } from "./questions.js";
import { QaSessionOwnership } from "./session-ownership.js";
import { entryRedirectRow } from "./entry-redirect.js";
import { qaKioskDeployment } from "./ui-mode.js";
import { registerQaNavigationRoute } from "./host-route.js";
import { makeLaunchTokenSource } from "./launch-token.js";
import { QaIntegrationPrincipalBindings } from "./integration-principals.js";
import { registerQaIntegrationRoutes } from "./integration/http.js";
import { createQaIntegrationRunner } from "./integration/host-runner.js";
import { QaIntegrationService } from "./integration/service.js";
import { QaPolicyAdmission } from "./secure-session.js";
import { QaAccessService } from "./access/service.js";
import { createQaSlashRemotes } from "./slash/remotes.js";
import type { QaSlashRemotes } from "./slash/remotes.js";
import { QaPromptNotes } from "./prompt-notes.js";
import { QaTools } from "./qa-tools/index.js";
import { docsDefaultVersionOf } from "./config-resolvers/tools.js";
import { QaProvenanceHost } from "./provenance/host-store.js";
import {
  defaultLegacyProvenanceFilePath,
  defaultQaProvenanceDirectoryPath,
  FileQaProvenanceSnapshotStore,
} from "./provenance/snapshot-store.js";
import { previewConvertibleDocument } from "./provenance/document-preview.js";
import {
  listWorkspaceDirectory,
  readSourceFilePreview,
  readWorkspaceFile,
  QaSourcePreviewError,
} from "./provenance/file-preview.js";
import {
  existingQaUserWorkspace,
  prepareQaUserWorkspace,
} from "./user-workspace.js";
import type { DocumentsFace } from "@yadsh/dsh-documents";
import type { QaTurnSources } from "./provenance/types.js";
import type {
  QaAccountProfileInput,
  QaAccountSession,
  QaAccountStartersInput,
  QaAccountUserPublic,
  QaApprovalDecision,
  QaClaimResult,
  QaDocumentPreview,
  QaIssuedServiceToken,
  QaLockdownProof,
  QaOwnershipEntry,
  QaPasswordResetRequest,
  QaPendingApproval,
  QaPendingQuestion,
  QaQuestionAnswerItem,
  QaServiceTokenCreateInput,
  QaServiceTokenSummary,
  QaSurfaceConfig,
  ResolvedQaSurfaceConfig,
  QaAdminSkillScope,
  QaAdminSkillsView,
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillRemoval,
  QaSkillSummary,
  QaSkillToolDescriptor,
  QaSkillValidation,
  QaSourceFilePreview,
  QaWhoamiResult,
  QaWorkspaceFile,
  QaWorkspaceListing,
  QaPrincipal,
  QaAccessAdminSnapshot,
  QaAdminAuditEvent,
  QaAdminOverview,
  QaAdminPage,
  QaAdminUserDetail,
  QaAdminUserRow,
  QaAdminUserUpdate,
  QaAuditQuery,
  QaCapabilitySelection,
  QaConversationDetail,
  QaConversationDeletion,
  QaConversationQuery,
  QaConversationReview,
  QaConversationReviewInput,
  QaConversationSummary,
  QaCurrentAccess,
  QaFeedbackQuery,
  QaFeedbackRow,
  QaMessageFeedback,
  QaMessageFeedbackInput,
  QaQualityMetrics,
  QaReviewQueueItem,
  QaReviewQueueRow,
  QaSessionAccess,
  QaSlashCatalog,
  QaSlashExecution,
  QaSlashSubmitAttachment,
  QaSkillActivationRecord,
  QaSkillAssignmentOverride,
  QaSubrole,
  QaUserAccess,
  QaUserQuery,
} from "./types.js";

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
type QaSourcePreviewRefusal =
  "outside-roots" | "not-evidence" | "unavailable" | "unsupported";

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
  private readonly fileDeleteGate: QaFileDeleteGate;
  private readonly userQuestions: QaQuestionGate;
  private readonly provenance: QaProvenanceHost;
  private readonly notes: QaPromptNotes;
  /** Assigned after the admission gate; that gate only reads it per execution. */
  private readonly tools!: QaTools;
  /** Account-remote bodies; the wire signatures stay on this class. */
  private readonly accountRemotes: QaAccountRemotes;
  /** Roles, assignments, discovery and immutable per-session capability sets. */
  private readonly access: QaAccessService;
  /**
   * The administrative console: authorization, conversation queries over
   * stored logs, quality records and their aggregations.
   */
  private readonly admin: QaAdminService;
  /** Personal skills: storage, the DSH provider and the manual-edit watcher. */
  private readonly personalSkills: QaPersonalSkillsHost;
  /** Personal-skill remote bodies; the wire signatures stay on this class. */
  private readonly skillRemotes: QaPersonalSkillRemotes;
  /**
   * Slash-catalog and command-admission bodies. Admission, not execution:
   * the native skill and command runtimes stay the only things that know what
   * a `/name` means.
   */
  private readonly slashRemotes: QaSlashRemotes;
  private readonly launchToken: ReturnType<typeof makeLaunchTokenSource>;
  /** Root session principals attested for their owner, never for admin viewing. */
  private readonly integrationPrincipals = new QaIntegrationPrincipalBindings();
  private webServer:
    Parameters<typeof registerQaNavigationRoute>[0] | undefined;
  private disposeRoute: (() => void) | undefined;
  private routeKey: string | undefined;
  /**
   * The HTTP API an external application asks questions through. Constructed
   * always — it is cheap and stateless until a request arrives — and exposed
   * on the network only while the deployment turns it on.
   */
  private readonly integration: QaIntegrationService;
  private disposeIntegrationRoutes: (() => void) | undefined;
  private integrationRouteKey: string | undefined;
  /**
   * The quality store opens its file on first use, so a deployment that never
   * opens the admin console never grows one.
   */
  private qualityStore: QaQualityStore | undefined;

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
    // One durable-session reader for the whole plugin: the console lists the
    // deployment's conversations with it, and the access service tells a chat
    // from a delegated child with it.
    const sessionLog = createSessionLogReader(ctx);
    this.access = new QaAccessService(ctx, {
      accounts: () => this.accountRemotes.resolve(this.getConfig()),
      config: () => this.getConfig(),
      logger: this.logger,
      dynamicToolNames: () => this.tools?.catalogToolNames() ?? [],
      presetScope: () => this.qaPresetScope(),
      sessionLog,
      // The record the sweep reclaims is the authorization boundary, not the
      // whole of what the deployment kept about a chat: the quality rows a
      // conversation owns outlive it unless they are dropped here.
      onVanishedSessions: (sessionIds) => {
        this.dropVanishedChats(sessionIds);
      },
    });
    this.personalSkills = new QaPersonalSkillsHost({
      ctx,
      getConfig: () => this.getConfig(),
      logger: this.logger,
    });
    this.admin = new QaAdminService({
      accounts: () => this.accountRemotes.resolve(this.getConfig()),
      quality: () => this.quality(),
      roles: () => this.access.roles,
      access: () => this.access,
      sessionLog,
      // Deletion is the console's alone: the sidebar's delete stays a
      // per-browser row, and only an administrator removes the chat itself.
      sessionFiles: createSessionEraser(),
      dropSources: (sessionId) => this.provenance.dropSession(sessionId),
      // The console writes skills through the same service the owner's editor
      // uses, so an administrator's save is path-checked, validated and
      // published to DSH by exactly the one code path that already does it.
      skills: () => this.personalSkills.service,
      logger: this.logger,
    });
    this.skillRemotes = createQaPersonalSkillRemotes({
      getConfig: () => this.getConfig(),
      logger: this.logger,
      skills: this.personalSkills.service,
      accounts: this.accountRemotes,
    });
    this.slashRemotes = createQaSlashRemotes({
      ctx,
      getConfig: () => this.getConfig(),
      logger: this.logger,
      sessionGrant: (token, sessionId, agent) =>
        this.slashSessionGrant(token, sessionId, agent),
    });
    this.admission = new QaPolicyAdmission(
      ctx,
      () => this.getConfig(),
      this.logger,
      // Identity half of admission; no-ops while accounts stay disabled.
      {
        enforceSessionAccess: (token, sessionId, facts) => {
          return this.accountRemotes
            .resolve(this.getConfig())
            ?.ensureSessionAccess(token, sessionId, facts);
        },
        userWorkspace: (userId, registeredWorkspacePath) =>
          existingQaUserWorkspace(registeredWorkspacePath, userId),
        // Read only by the integration API, whose caller proved an account
        // with a service token instead of a browser one. The ownership
        // record stays the authority either way.
        ownerIdOf: (sessionId) =>
          this.accountRemotes.resolve(this.getConfig())?.ownerIdOf(sessionId),
      },
      // Legacy account-free sessions retain the dynamic catalog behavior;
      // role-managed sessions authorize its known entries through the frozen
      // capability policy instead.
      (agent) => this.tools?.activeToolNames(agent) ?? [],
      (owner, sessionId, agent) =>
        this.access.policyForSessionOwner(owner, sessionId, agent),
      () => this.tools?.catalogToolNames() ?? [],
    );
    this.provenance = new QaProvenanceHost(
      ctx,
      () => this.getConfig(),
      // Sharded per chat and bounded by the resolved retention policy: the
      // turn path must never rewrite history it did not touch.
      new FileQaProvenanceSnapshotStore(
        defaultQaProvenanceDirectoryPath(),
        () => this.getConfig().sources.retention,
        defaultLegacyProvenanceFilePath(),
      ),
      (error) =>
        this.logger.error("sources.persistence-failed", {
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    this.integration = new QaIntegrationService({
      getConfig: () => this.getConfig(),
      accounts: () => this.accountRemotes.resolve(this.getConfig()),
      runner: createQaIntegrationRunner({
        ctx,
        getConfig: () => this.getConfig(),
        accounts: () => this.accountRemotes.resolve(this.getConfig()),
        admission: this.admission,
        access: this.access,
        sessionLog,
        provenance: this.provenance,
        // Resolved per call, like the files panel does it: the document plugin
        // may install after this one, and a document attachment that arrives
        // before it did is refused with the caller's own fallback signal.
        documents: () => ctx.get("documents") as DocumentsFace | undefined,
        logger: this.logger,
      }),
      logger: this.logger,
      version: qaSurfaceVersion(),
    });
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
    // The destructive tool of the QA catalog composes the same approval flow
    // around itself: registered without `prepend`, it sits inside the approval
    // gate and answers `ask` for every file_delete call of an attested chat,
    // so the interactive card parks it for the operator (or the blocked
    // configuration refuses it — nothing is deleted without a person).
    this.fileDeleteGate = new QaFileDeleteGate(ctx, ownership);
    this.approvals.install();
    this.userQuestions.install();
    this.fileDeleteGate.install();
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
    // suffices. Resolved lazily per navigation: a resolved token is cached for
    // the process, while a bridge that is not answerable yet is retried rather
    // than written off, so a request that races plugin init falls back to the
    // marker hand-off once and the next one installs the cookie.
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
      () => () => this.fileDeleteGate.dispose(),
      "dsh-qa-surface.file-delete-gate",
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
    this.warnDocumentsMoved();
    this.warnLegacySlashDefaults();
    // The QA tool catalog is attached per agent, never at boot: nothing here
    // reaches the model until a managed agent loads the activation skill.
    this.tools = new QaTools(ctx, {
      logger: this.logger,
      dynamicActivation: this.getConfig().tools.dynamicActivation,
      activationSkill: this.getConfig().tools.activationSkill,
      activationMode: this.getConfig().tools.activationMode,
      activationPresets: this.getConfig().tools.activationPresets,
      // Settings can change without recreating the plugin. The catalog keeps
      // these readers so an already-activated tool uses the current corpus and
      // default edition rather than the boot-time snapshot.
      docsRoot: () => this.getConfig().tools.docsRoot,
      docsDefaultVersion: () => docsDefaultVersionOf(this.getConfig().tools),
    });
    ctx.effect(() => () => this.tools.dispose(), "dsh-qa-surface.qa-tools");
    // The root index gains one head script: non-loopback hostnames continue
    // into /qa, the loopback operator keeps the full harness UI. Not in the
    // kiosk composition: there the index itself is served under /qa, so the
    // script would meet its own target on every load and reload the page in
    // a loop, and the server policy already routes the site root into /qa.
    if (!qaKioskDeployment()) {
      ctx.on("webserver/index-inject", (table) => {
        const row = entryRedirectRow(this.getConfig());
        if (row !== undefined) table.push(row);
      });
    }
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
            this.refreshIntegrationRoutes();
            this.warnDocumentsMoved();
            this.warnLegacySlashDefaults();
            this.logger.info("config.updated", {
              enabled: config.enabled,
              route: config.route.path,
              sessionPolicy: config.session.policy,
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
      this.refreshIntegrationRoutes();
      webContext.effect(
        () => () => {
          this.disposeRoute?.();
          this.disposeRoute = undefined;
          this.routeKey = undefined;
          this.disposeIntegrationRoutes?.();
          this.disposeIntegrationRoutes = undefined;
          this.integrationRouteKey = undefined;
          this.webServer = undefined;
        },
        "dsh-qa-surface.navigation-route",
      );
    });
    this.logger.info("plugin.ready", {
      enabled: resolvedEntry.enabled,
      route: resolvedEntry.route.path,
      sessionPolicy: resolvedEntry.session.policy,
      // What the two parked-interaction seams resolve to on this deployment:
      // the attestation path warns per session when the question seam and the
      // tool policy disagree, and this is the config they are read against.
      approvals: resolvedEntry.interaction.approvals,
      questions: resolvedEntry.interaction.questions,
    });
  }

  /** The quality store, opening its file the first time anyone needs it. */
  private quality(): QaQualityStore {
    this.qualityStore ??= new QaQualityStore();
    return this.qualityStore;
  }

  /**
   * The standing scope of the preset QA chats run under, so an administrator's
   * capability catalog is read the way a chat reads it. Everything a preset
   * mounts — its skill catalog, its tool family — is registered in that scope,
   * and a global-only read showed the operator an almost empty page. Resolving
   * the preset composes it but starts no agent, no session and no turn;
   * without a pinned preset there is nothing to borrow, and the read stays
   * global.
   */
  private async qaPresetScope(): Promise<ScopeKey | undefined> {
    const preset = this.getConfig().session.agentPreset;
    if (preset === null || preset === undefined) return undefined;
    return await this.ctx.agentPresets.standingKeyFor(preset);
  }

  /**
   * Drop what the quality layer kept about chats that no longer exist in the
   * Harness. The ownership sweep calls this with the ids it reclaimed: the
   * record it removes is one thing the deployment held about a chat, and
   * ratings, reviews and queue entries are the rest. Failure is logged and
   * swallowed — housekeeping runs inside a review read, and a store that
   * cannot be opened must not fail the page that triggered it.
   */
  private dropVanishedChats(sessionIds: readonly string[]): void {
    try {
      const rows = this.quality().dropConversations(sessionIds);
      this.logger.info("quality.vanished-conversations-dropped", {
        conversations: sessionIds.length,
        rows,
        sessionIds: sessionIds.slice(0, 20),
      });
    } catch (error) {
      this.logger.error("quality.vanished-conversations-drop-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
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
   * Ownership plus the role's user-skill grant for one slash read.
   *
   * Ownership comes first and for the same reason the rest of the plugin does
   * it: a catalog names the skills a chat can reach, and a foreign browser has
   * no business enumerating that. With accounts off there is no identity to
   * check and the deployment's lockdown is the boundary, exactly as it is for
   * every other remote.
   *
   * The grant mirrors `installQaSkillPolicy` to the letter — an empty
   * `userSkills` list means the role keeps no separate user list, not that it
   * grants nothing — so the palette can never offer a skill the typed gesture
   * would refuse, nor hide one it would accept.
   */
  private async slashSessionGrant(
    token: string,
    sessionId: string,
    agent: unknown,
  ): Promise<readonly string[] | undefined> {
    const accounts = this.accountRemotes.resolve(this.getConfig());
    if (accounts === undefined) return undefined;
    if (agent === undefined) {
      // A cold chat has no capability snapshot to read, but it still has an
      // owner, and that is what the catalog read must respect.
      this.accountRemotes.run(() => this.access.session(token, sessionId));
      return undefined;
    }
    const resolved = await this.access.policyForSession(
      token,
      sessionId,
      agent as Agent,
    );
    if (resolved === undefined) return undefined;
    const { policy } = resolved;
    return policy.userSkills.length === 0 ? policy.skills : policy.userSkills;
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
  @Remote("accountsChangePassword")
  accountsChangePassword(
    token: string,
    currentPassword: string,
    nextPassword: string,
  ): QaAccountSession {
    return this.accountRemotes.changePassword(
      token,
      currentPassword,
      nextPassword,
    );
  }

  /**
   * The sign-in screen's "забыли пароль?" path. It answers the same way for
   * every address: whether an account exists is not something this endpoint
   * tells a caller.
   */
  @Remote("accountsRequestPasswordReset")
  accountsRequestPasswordReset(email: string): { readonly accepted: true } {
    this.accountRemotes.requestPasswordReset(email);
    return { accepted: true };
  }

  @Remote("accountsWhoami")
  accountsWhoami(token: string): QaWhoamiResult {
    return this.accountRemotes.whoami(token);
  }

  /**
   * Migrate a browser's local chat index into server-side ownership. The
   * access service owns the filter: a delegated session in that index is not a
   * chat and is never claimed.
   */
  @Remote("accountsClaimSessions")
  accountsClaimSessions(
    token: string,
    sessionIds: readonly string[],
  ): QaClaimResult {
    return this.accountRemotes.run(() =>
      this.access.claimSessions(token, sessionIds),
    );
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
   * The caller's own integration tokens. The list is the account's own: the
   * token names it, and a secret is never part of a summary, so reading this
   * cannot repeat a credential that was already handed over.
   */
  @Remote("accountsListServiceTokens")
  accountsListServiceTokens(token: string): {
    readonly tokens: readonly QaServiceTokenSummary[];
  } {
    return this.accountRemotes.listServiceTokens(token);
  }

  /**
   * Mint one integration token for the caller. The answer carries the
   * plaintext exactly once — nothing stores it, so nothing can repeat it — and
   * the account is always the authenticated one: there is no owner field on
   * the wire.
   */
  @Remote("accountsCreateServiceToken")
  accountsCreateServiceToken(
    token: string,
    input: QaServiceTokenCreateInput,
  ): QaIssuedServiceToken {
    return this.accountRemotes.createServiceToken(token, input);
  }

  /**
   * Revoke one of the caller's own integration tokens. This is the immediate
   * kill switch the profile page offers: the next request that presents the
   * credential is refused, without waiting for its expiry.
   */
  @Remote("accountsRevokeServiceToken")
  accountsRevokeServiceToken(
    token: string,
    tokenId: string,
  ): { readonly revoked: boolean } {
    return this.accountRemotes.revokeServiceToken(token, tokenId);
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
      // This call is the only way the browser could have learned the id, so a
      // failure at any stage — the Host creating the session, selecting the
      // model, the admission refusing the composition — leaves no chat behind
      // and the reservation goes with it. A kept record would put an empty
      // chat in the account's list, and nothing else would ever remove it.
      if (owner !== undefined) {
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

  /** Layer one administrator assignment over what a SKILL.md declares. */
  @Remote("accessUpdateSkillOverride")
  accessUpdateSkillOverride(
    token: string,
    input: QaSkillAssignmentOverride,
  ): readonly QaSkillAssignmentOverride[] {
    return this.accountRemotes.run(() =>
      this.access.updateSkillOverride(token, input),
    );
  }

  /** What each skill activation actually granted in this session. */
  @Remote("accessSkillActivations")
  accessSkillActivations(
    token: string,
    sessionId: string,
  ): readonly QaSkillActivationRecord[] {
    return this.accountRemotes.run(
      () => this.access.skillActivations(token, sessionId),
      sessionId,
    );
  }

  // ---------------------------------------------------------------------------
  // Administrative console. Every method names its permission inside the
  // service; the wire carries a token and never an identity.
  // ---------------------------------------------------------------------------

  /**
   * The skill catalog of one scope: the deployment's shared skills, or the
   * personal skills of the account the scope names. Reading another account's
   * skills is an administrative act, so it needs `skills.manage`.
   */
  @Remote("adminSkills")
  adminSkills(
    token: string,
    scope: QaAdminSkillScope,
  ): Promise<QaAdminSkillsView> {
    return this.accountRemotes.runAsync(() => this.admin.skills(token, scope));
  }

  /** One skill file with the body, revision and administrator mark. */
  @Remote("adminSkill")
  adminSkill(
    token: string,
    scope: QaAdminSkillScope,
    name: string,
  ): Promise<QaSkillDocument> {
    return this.accountRemotes.runAsync(() =>
      this.admin.skill(token, scope, name),
    );
  }

  /**
   * Create (`name` null) or replace one skill in place. The write is recorded
   * as this administrator's, and the owner sees that it was.
   */
  @Remote("adminSkillSave")
  adminSkillSave(
    token: string,
    scope: QaAdminSkillScope,
    name: string | null,
    input: QaSkillDraftInput,
  ): Promise<QaSkillDocument> {
    return this.accountRemotes.runAsync(() =>
      this.admin.saveSkill(token, scope, name, input),
    );
  }

  /** Remove one skill into the trash beside its own skills root. */
  @Remote("adminSkillDelete")
  adminSkillDelete(
    token: string,
    scope: QaAdminSkillScope,
    name: string,
    expectedRevision: string | null,
  ): Promise<QaSkillRemoval> {
    return this.accountRemotes.runAsync(() =>
      this.admin.removeSkill(token, scope, name, expectedRevision),
    );
  }

  /** The file a save would write, plus every diagnostic for the draft. */
  @Remote("adminSkillValidate")
  adminSkillValidate(
    token: string,
    scope: QaAdminSkillScope,
    name: string | null,
    input: QaSkillDraftInput,
  ): Promise<QaSkillValidation> {
    return this.accountRemotes.runAsync(() =>
      this.admin.validateSkill(token, scope, name, input),
    );
  }

  /** The tool catalog the picker offers for one scope. */
  @Remote("adminSkillTools")
  async adminSkillTools(
    token: string,
    scope: QaAdminSkillScope,
  ): Promise<{ readonly tools: readonly QaSkillToolDescriptor[] }> {
    const tools = await this.accountRemotes.runAsync(() =>
      this.admin.skillTools(token, scope),
    );
    return { tools };
  }

  /** Counters, attention lines and the newest quality signals. */
  @Remote("adminOverview")
  adminOverview(token: string): Promise<QaAdminOverview> {
    return this.accountRemotes.runAsync(() => this.admin.overview(token));
  }

  @Remote("adminUsers")
  adminUsers(
    token: string,
    query: QaUserQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<QaAdminPage<QaAdminUserRow>> {
    return this.accountRemotes.runAsync(() =>
      this.admin.users(token, query, cursor ?? undefined, limit ?? undefined),
    );
  }

  @Remote("adminUser")
  adminUser(token: string, userId: string): Promise<QaAdminUserDetail> {
    return this.accountRemotes.runAsync(() => this.admin.user(token, userId));
  }

  /** Authorization role, status and subrole assignment of one account. */
  @Remote("adminUpdateUser")
  adminUpdateUser(
    token: string,
    userId: string,
    update: QaAdminUserUpdate,
  ): Promise<QaAdminUserDetail> {
    return this.accountRemotes.runAsync(() =>
      this.admin.updateUser(token, userId, update),
    );
  }

  @Remote("adminPasswordResetRequests")
  adminPasswordResetRequests(
    token: string,
  ): Promise<readonly QaPasswordResetRequest[]> {
    return this.accountRemotes.runAsync(() =>
      this.admin.passwordResetRequests(token),
    );
  }

  @Remote("adminResetPassword")
  adminResetPassword(
    token: string,
    userId: string,
    password: string,
  ): Promise<QaAdminUserDetail> {
    return this.accountRemotes.runAsync(() =>
      this.admin.resetUserPassword(token, userId, password),
    );
  }

  @Remote("adminConversations")
  adminConversations(
    token: string,
    query: QaConversationQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<QaAdminPage<QaConversationSummary>> {
    return this.accountRemotes.runAsync(() =>
      this.admin.conversations(
        token,
        query,
        cursor ?? undefined,
        limit ?? undefined,
      ),
    );
  }

  /** One conversation with its messages, tool calls and review state. */
  @Remote("adminConversation")
  adminConversation(
    token: string,
    conversationId: string,
  ): Promise<QaConversationDetail> {
    return this.accountRemotes.runAsync(() =>
      this.admin.conversation(token, conversationId),
    );
  }

  /**
   * Remove one conversation from the deployment. Admin-only, audited, and the
   * only path that deletes what a person wrote — the sidebar's own delete
   * stays what it always was, a per-browser row.
   */
  @Remote("adminDeleteConversation")
  adminDeleteConversation(
    token: string,
    conversationId: string,
  ): Promise<QaConversationDeletion> {
    return this.accountRemotes.runAsync(() =>
      this.admin.deleteConversation(token, conversationId),
    );
  }

  @Remote("adminFeedback")
  adminFeedback(
    token: string,
    query: QaFeedbackQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<QaAdminPage<QaFeedbackRow>> {
    return this.accountRemotes.runAsync(() =>
      this.admin.feedback(
        token,
        query,
        cursor ?? undefined,
        limit ?? undefined,
      ),
    );
  }

  /**
   * Rate one of the caller's own assistant messages. The token names the only
   * ratable conversation, exactly as the self-service profile write does.
   */
  @Remote("adminRateMessage")
  adminRateMessage(
    token: string,
    conversationId: string,
    messageId: string,
    input: QaMessageFeedbackInput,
  ): QaMessageFeedback {
    return this.accountRemotes.run(() =>
      this.admin.rateMessage(token, conversationId, messageId, input),
    );
  }

  @Remote("adminReviewQueue")
  adminReviewQueue(
    token: string,
    cursor: string | null,
    limit: number | null,
  ): Promise<QaAdminPage<QaReviewQueueRow>> {
    return this.accountRemotes.runAsync(() =>
      this.admin.reviewQueue(token, cursor ?? undefined, limit ?? undefined),
    );
  }

  /** Park a conversation for review without rating it. */
  @Remote("adminQueueConversation")
  adminQueueConversation(
    token: string,
    conversationId: string,
    messageId: string | null,
  ): QaReviewQueueItem {
    return this.accountRemotes.run(() =>
      this.admin.queueConversation(
        token,
        conversationId,
        messageId ?? undefined,
      ),
    );
  }

  @Remote("adminSaveReview")
  adminSaveReview(
    token: string,
    input: QaConversationReviewInput,
  ): QaConversationReview {
    return this.accountRemotes.run(() => this.admin.saveReview(token, input));
  }

  @Remote("adminMetrics")
  adminMetrics(token: string): Promise<QaQualityMetrics> {
    return this.accountRemotes.runAsync(() => this.admin.metrics(token));
  }

  @Remote("adminAudit")
  adminAudit(
    token: string,
    query: QaAuditQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<QaAdminPage<QaAdminAuditEvent>> {
    return this.accountRemotes.runAsync(() =>
      this.admin.audit(token, query, cursor ?? undefined, limit ?? undefined),
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

  /**
   * List one directory of the chat's own workspace for the files panel.
   *
   * Browsing is deliberately narrower than the source preview: it stays inside
   * the chat's own directory tree, so a visitor can look at what their
   * conversation produced and at nothing else of the deployment.
   * `readWorkspaceFile` opens one entry of such a listing.
   */
  @Remote("listWorkspaceFiles")
  async listWorkspaceFiles(
    token: string,
    sessionId: string,
    path: string,
  ): Promise<QaWorkspaceListing> {
    await this.admission.secureSession(token, sessionId);
    const { config, cwd } = await this.browseContext(sessionId);
    try {
      return await listWorkspaceDirectory({
        dirPath: path ?? "",
        cwd,
        maxEntries: config.sources.filePreview.maxListingEntries,
      });
    } catch (error) {
      throw this.browseRefusal("workspace.list-refused", sessionId, error);
    }
  }

  /**
   * Read one file of the chat's workspace: text when it decodes as UTF-8, bytes
   * when it does not, so a document the agent produced can be downloaded while
   * a note previews inline. The readable roots are the ones the model itself
   * may read; unlike the source preview this does not require the file to be
   * recorded evidence, because the panel is browsing a tree rather than
   * reopening a cited source.
   */
  @Remote("readWorkspaceFile")
  async readWorkspaceFile(
    token: string,
    sessionId: string,
    path: string,
  ): Promise<QaWorkspaceFile> {
    await this.admission.secureSession(token, sessionId);
    const { config, cwd } = await this.browseContext(sessionId);
    const attachmentRoot = this.admission.attachmentRoot();
    try {
      return await readWorkspaceFile({
        filePath: path ?? "",
        cwd,
        sharedReadOnlyRoots: config.lockdown.sharedReadOnlyRoots,
        ...(attachmentRoot === undefined ? {} : { attachmentRoot }),
        maxBytes: config.sources.filePreview.maxBytes,
        maxMarkdownRenderBytes:
          config.sources.filePreview.maxMarkdownRenderBytes,
      });
    } catch (error) {
      throw this.browseRefusal("workspace.read-refused", sessionId, error);
    }
  }

  /**
   * Render one Word document of the chat's workspace as a PDF for the panel.
   *
   * The conversion is the document pipeline's own, reached through the service
   * `@yadsh/dsh-documents` publishes for its Host siblings — the panel gets the
   * same providers, limits and refusals the `document_*` tools see, and a
   * deployment without that plugin refuses instead of showing a guess. The
   * produced PDF is read back here and travels as base64, so the audience never
   * reaches an unfenced byte route.
   */
  @Remote("previewWorkspaceDocument")
  async previewWorkspaceDocument(
    token: string,
    sessionId: string,
    path: string,
  ): Promise<QaDocumentPreview> {
    await this.admission.secureSession(token, sessionId);
    const { config, cwd } = await this.browseContext(sessionId);
    const attachmentRoot = this.admission.attachmentRoot();
    try {
      return await previewConvertibleDocument({
        filePath: path ?? "",
        cwd,
        sharedReadOnlyRoots: config.lockdown.sharedReadOnlyRoots,
        ...(attachmentRoot === undefined ? {} : { attachmentRoot }),
        documents: () => this.ctx.get("documents") as DocumentsFace | undefined,
        sessionId,
        maxBytes: config.sources.filePreview.maxBytes,
      });
    } catch (error) {
      throw this.browseRefusal("workspace.preview-refused", sessionId, error);
    }
  }

  /**
   * Shared admission facts of both browse methods: the preview switch is what
   * opens the panel's file reading at all, and the chat's cwd is the tree that
   * browsing is confined to.
   */
  private async browseContext(sessionId: string): Promise<{
    readonly config: ResolvedQaSurfaceConfig;
    readonly cwd: string;
  }> {
    const config = this.getConfig();
    if (!config.sources.filePreview.enabled) {
      throw sourcePreviewRefusal("unavailable");
    }
    const agent = this.ctx.agents.get(
      (await import("@deepseek-ai/dsh-session/types")).SessionId(sessionId),
    );
    const cwd = agent?.session.header.cwd;
    if (cwd === undefined) throw sourcePreviewRefusal("unavailable");
    return { config, cwd };
  }

  /** One browse refusal, logged with its coarse reason and rethrown for the wire. */
  private browseRefusal(
    event: string,
    sessionId: string,
    error: unknown,
  ): Error {
    const reason =
      error instanceof QaSourcePreviewError ? error.reason : "unavailable";
    this.logger.debug(event, { sessionId, reason });
    return sourcePreviewRefusal(reason);
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

  /**
   * The slash entries this browser may offer for one chat: the session's
   * user-invocable skills and its agent's effective commands, already cut down
   * by the deployment policy and by the chat's role. The browser filters and
   * ranks this list; it never widens it.
   *
   * Enabled is reported rather than assumed, so a page that loaded before the
   * operator flipped the master switch learns the truth instead of showing an
   * empty palette forever.
   */
  @Remote("slashCatalog")
  slashCatalog(token: string, sessionId: string): Promise<QaSlashCatalog> {
    return this.slashRemotes.catalog(token, sessionId);
  }

  /**
   * Run one human command line. The line is the whole request — the browser
   * sends no name, no kind and no descriptor, so there is nothing for it to
   * forge; admission re-derives the name and re-checks the policy against the
   * deployment's own config.
   *
   * A command never becomes a model message: the native runtime answers it and
   * writes `command/run`/`command/done` into the session log, which is where
   * the transcript row is read from.
   */
  @Remote("slashExecute")
  slashExecute(
    token: string,
    sessionId: string,
    line: string,
    attachments: readonly QaSlashSubmitAttachment[],
  ): Promise<QaSlashExecution> {
    return this.slashRemotes.execute(token, sessionId, line, attachments);
  }

  /**
   * Register (or drop) the integration API's routes for the current config.
   *
   * The key is the whole registration decision — whether the API is on and
   * where it lives — so a config change that does not move the endpoints
   * leaves the live routes alone, and turning the API off disposes them
   * immediately rather than at the next restart.
   */
  private refreshIntegrationRoutes(): void {
    const config = this.getConfig();
    const key =
      config.integration.enabled && config.accounts.enabled
        ? `${config.integration.basePath}:${String(config.integration.maxRequestBytes)}:${String(config.integration.maxAttachmentBytes)}`
        : undefined;
    if (key === this.integrationRouteKey) return;
    this.disposeIntegrationRoutes?.();
    this.disposeIntegrationRoutes = undefined;
    this.integrationRouteKey = undefined;
    if (key === undefined || this.webServer === undefined) return;
    try {
      this.disposeIntegrationRoutes = registerQaIntegrationRoutes(
        this.webServer,
        { config, service: this.integration, logger: this.logger },
      );
      this.integrationRouteKey = key;
      this.logger.info("integration.routes-registered", {
        basePath: config.integration.basePath,
      });
    } catch (error) {
      // A collision on (kind, path) means another plugin owns the namespace.
      // The page and the accounts keep working; only the API stays off, and
      // the operator sees why.
      this.logger.error("integration.routes-failed", {
        basePath: config.integration.basePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private refreshRoute(): void {
    const config = this.getConfig();
    // Kiosk: the harness route policy owns the QA paths and serves the
    // application there directly. This plugin's navigation redirect route
    // must not register — a named route shadows the fallback seat, so it
    // would bounce every /qa navigation to /?marker while the policy bounces
    // / back to /qa: a redirect loop. The kiosk key keeps the transition
    // machinery honest (dispose on entering kiosk, no re-registration, one
    // log line per transition).
    const key = qaKioskDeployment()
      ? "kiosk"
      : config.enabled
        ? `${config.route.path}:${config.route.matchChildren}`
        : undefined;
    if (key === this.routeKey) return;
    this.disposeRoute?.();
    this.disposeRoute = undefined;
    this.routeKey = undefined;
    if (key === undefined || this.webServer === undefined) return;
    if (key === "kiosk") {
      this.logger.info("route.kiosk", {
        message:
          "DSH_UI_MODE=qa: the navigation redirect route is not registered; the harness route policy serves the QA surface directly",
      });
      this.routeKey = key;
      return;
    }
    this.disposeRoute = registerQaNavigationRoute(this.webServer, config, {
      launchToken: this.launchToken,
    });
    this.routeKey = key;
  }

  /**
   * A deployment that set `lockdown.allowSlashCommands: true` before this
   * section existed keeps the behaviour it asked for — skills at `all`,
   * commands denied — and is told so once per configuration change, because
   * "skills appeared after the upgrade" is otherwise indistinguishable from a
   * defect. Commands are never part of that fallback: an upgrade must not hand
   * the user a control-plane command nobody named.
   */
  private warnLegacySlashDefaults(): void {
    if (!this.getConfig().slashCommands.legacyDefaults) return;
    this.logger.warn("slash.legacy-defaults", {
      message:
        "lockdown.allowSlashCommands=true without a slashCommands section: every user-invocable skill is admitted and no human command is. Declare slashCommands.commands to enable commands explicitly.",
    });
  }

  /**
   * The document pipeline moved out of this plugin into `@yadsh/dsh-documents`.
   * A deployment whose profile still carries the old `documents` section would
   * otherwise lose its Docling endpoint and artifact root silently, so the
   * leftover section is reported once per configuration change instead.
   */
  private warnDocumentsMoved(): void {
    // The section is no longer part of this plugin's schema, so it is read off
    // the raw entry: unknown keys survive schema parsing on purpose.
    const legacy = (this.source() as { documents?: Record<string, unknown> })
      .documents;
    if (legacy === undefined || Object.keys(legacy).length === 0) return;
    this.logger.warn("documents.moved", {
      plugin: "@yadsh/dsh-documents",
      message:
        "the documents section moved to the @yadsh/dsh-documents plugin; the copy under qa-surface is ignored",
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
export { QaPolicyAdmission } from "./secure-session.js";
export { QaAccessService } from "./access/service.js";
export { QaRoleRepository } from "./access/role-repository.js";
export { QaAgentToolGrants } from "./enforcement/tool-grants.js";
export {
  defaultCapabilityConfig,
  normalizeCapabilityConfig,
  normalizeUserAccess,
  resolveCapabilityPolicy,
  resolveSkillAccess,
} from "./access/model.js";
export {
  parseQaSkillMetadata,
  resolveSkillVisibility,
} from "./access/skill-metadata.js";
export {
  QaPromptNotes,
  renderUserIdentity,
  QA_IDENTITY_NOTE,
  QA_SOURCES_NOTE,
} from "./prompt-notes.js";
export * from "./provenance/index.js";
export type * from "./types.js";
export default QaSurface;
