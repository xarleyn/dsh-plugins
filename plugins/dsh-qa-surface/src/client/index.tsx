import type { Context } from "@deepseek-ai/cordis";
import type {
  ConnectionHandle,
  SessionId,
} from "@deepseek-ai/dsh-client-connection/client";
import type { SettingsScopeBinder } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import qaSurfaceRemote from "@yadsh/dsh-qa-surface/remote";
import type { ClientRemote } from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-api-session-controller/remote";
import type {} from "@deepseek-ai/dsh-agent-presets/remote";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import { registerSettingsCard } from "@yadsh/dsh-plugin-kit/client";
import { QaConfigController } from "./QaConfigController.js";
import { matchesQaRoute, QaRouteController } from "./QaRouteController.js";
import { QaAccountsController } from "./QaAccountsController.js";
import { QaChatIndex } from "./chat-index.js";
import { isDelegatedSession } from "./lineage.js";
import type { QaSurfaceFace } from "./QaSurface.js";
import { QaSurfaceGuard } from "./QaSurfaceGuard.js";
import { QaWelcomeNoticeStep } from "./components/QaWelcomeNotice.js";
import type {
  QaAccountsApi,
  QaAccessApi,
  QaAdminApi,
  QaApprovalApi,
  QaFileUpload,
  QaQuestionApi,
  QaSecureSession,
  QaSessions,
  QaSessionsApi,
  QaSkillApi,
  QaSlashApi,
  QaSourceApi,
} from "./types.js";
import { QA_OVERLAY_STYLES, QA_ROOT_STYLES } from "./styles.js";
import { qaKioskBasePath, qaKioskMode } from "./kiosk.js";
import { QaAuditController } from "./audit/controller.js";
import { createQaAuditApi, type QaAuditRemote } from "./audit/types.js";
import type {
  QaAccountSession,
  QaApprovalDecision,
  QaQuestionAnswerItem,
  QaClaimResult,
  QaLockdownProof,
  QaOwnershipEntry,
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillRemoval,
  QaSkillSummary,
  QaSkillToolDescriptor,
  QaSkillValidation,
  QaSlashCatalog,
  QaSlashExecution,
  QaSlashSubmitAttachment,
  QaSurfaceConfig,
  ResolvedQaSurfaceConfig,
  QaWhoamiResult,
  QaAccessAdminSnapshot,
  QaCapabilitySelection,
  QaCurrentAccess,
  QaSessionAccess,
  QaSkillActivationRecord,
  QaSkillAssignmentOverride,
  QaSubrole,
  QaUserAccess,
  QaAdminAuditEvent,
  QaAdminOverview,
  QaAdminPage,
  QaAdminSkillScope,
  QaAdminSkillsView,
  QaAdminUserDetail,
  QaAdminUserRow,
  QaAdminUserUpdate,
  QaAuditQuery,
  QaConversationDetail,
  QaConversationDeletion,
  QaConversationQuery,
  QaConversationReview,
  QaConversationReviewInput,
  QaConversationSummary,
  QaFeedbackQuery,
  QaFeedbackRow,
  QaMessageFeedback,
  QaMessageFeedbackInput,
  QaPasswordResetRequest,
  QaQualityMetrics,
  QaReviewQueueItem,
  QaReviewQueueRow,
  QaUserQuery,
} from "../types.js";
import { QA_SURFACE_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { qaStorageNamespace } from "../shared/session-key.js";
import { QaSettingsCard, type QaSettingsCardFace } from "./settings/card.js";
import { QA_SETTINGS_STYLES } from "./settings/styles.js";
import { QaSurfacePanelRegistry } from "./panels/registry.js";
import { QaUserSettingsSectionRegistry } from "./settings-extensions/index.js";
import { QaUserSessionMirror } from "./settings-extensions/user-session.js";
import type {} from "./panels/contract.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    connection: ConnectionHandle;
  }
}

// The namespace the Host registers under `qaSurface`: the session policy
// remotes this file calls directly, plus the account remotes the account
// controller drives. It mirrors what the typert declaration generates, so the
// client also type-checks from a checkout whose `lib/` has not been built yet.
/**
 * The console's methods exactly as the Host registers them under `qaSurface`.
 * The page-facing {@link QaAdminApi} drops the `admin` prefix; this mirror
 * keeps the wire names, so a rename on either side fails the build.
 */
interface QaAdminRemote {
  adminOverview(token: string): Promise<RemoteResult<QaAdminOverview>>;
  adminUsers(
    token: string,
    query: QaUserQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<RemoteResult<QaAdminPage<QaAdminUserRow>>>;
  adminUser(
    token: string,
    userId: string,
  ): Promise<RemoteResult<QaAdminUserDetail>>;
  adminUpdateUser(
    token: string,
    userId: string,
    update: QaAdminUserUpdate,
  ): Promise<RemoteResult<QaAdminUserDetail>>;
  adminPasswordResetRequests(
    token: string,
  ): Promise<RemoteResult<readonly QaPasswordResetRequest[]>>;
  adminResetPassword(
    token: string,
    userId: string,
    password: string,
  ): Promise<RemoteResult<QaAdminUserDetail>>;
  adminConversations(
    token: string,
    query: QaConversationQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<RemoteResult<QaAdminPage<QaConversationSummary>>>;
  adminConversation(
    token: string,
    conversationId: string,
  ): Promise<RemoteResult<QaConversationDetail>>;
  adminDeleteConversation(
    token: string,
    conversationId: string,
  ): Promise<RemoteResult<QaConversationDeletion>>;
  adminFeedback(
    token: string,
    query: QaFeedbackQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<RemoteResult<QaAdminPage<QaFeedbackRow>>>;
  adminRateMessage(
    token: string,
    conversationId: string,
    messageId: string,
    input: QaMessageFeedbackInput,
  ): Promise<RemoteResult<QaMessageFeedback>>;
  adminReviewQueue(
    token: string,
    cursor: string | null,
    limit: number | null,
  ): Promise<RemoteResult<QaAdminPage<QaReviewQueueRow>>>;
  adminQueueConversation(
    token: string,
    conversationId: string,
    messageId: string | null,
  ): Promise<RemoteResult<QaReviewQueueItem>>;
  adminSaveReview(
    token: string,
    input: QaConversationReviewInput,
  ): Promise<RemoteResult<QaConversationReview>>;
  adminMetrics(token: string): Promise<RemoteResult<QaQualityMetrics>>;
  adminAudit(
    token: string,
    query: QaAuditQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<RemoteResult<QaAdminPage<QaAdminAuditEvent>>>;
  adminSkills(
    token: string,
    scope: QaAdminSkillScope,
  ): Promise<RemoteResult<QaAdminSkillsView>>;
  adminSkill(
    token: string,
    scope: QaAdminSkillScope,
    name: string,
  ): Promise<RemoteResult<QaSkillDocument>>;
  adminSkillSave(
    token: string,
    scope: QaAdminSkillScope,
    name: string | null,
    input: QaSkillDraftInput,
  ): Promise<RemoteResult<QaSkillDocument>>;
  adminSkillDelete(
    token: string,
    scope: QaAdminSkillScope,
    name: string,
    expectedRevision: string | null,
  ): Promise<RemoteResult<QaSkillRemoval>>;
  adminSkillValidate(
    token: string,
    scope: QaAdminSkillScope,
    name: string | null,
    input: QaSkillDraftInput,
  ): Promise<RemoteResult<QaSkillValidation>>;
  adminSkillTools(
    token: string,
    scope: QaAdminSkillScope,
  ): Promise<
    RemoteResult<{ readonly tools: readonly QaSkillToolDescriptor[] }>
  >;
}

interface QaPolicyRemote extends QaAccountsApi, QaAdminRemote {
  createSession(
    token: string,
    subroleId: string | null,
    adminPreview: boolean,
  ): Promise<RemoteResult<string>>;
  secureSession(
    token: string,
    sessionId: string,
  ): Promise<RemoteResult<QaLockdownProof>>;
  describe(): Promise<RemoteResult<ResolvedQaSurfaceConfig>>;
  sources(
    token: string,
    sessionId: string,
  ): QaSourceApi extends {
    sources(token: string, sessionId: string): infer Result;
  }
    ? Result
    : never;
  readSourceFile(
    token: string,
    sessionId: string,
    sourcePath: string,
  ): QaSourceApi extends {
    readSourceFile(
      token: string,
      sessionId: string,
      sourcePath: string,
    ): infer Result;
  }
    ? Result
    : never;
  listWorkspaceFiles(
    token: string,
    sessionId: string,
    path: string,
  ): QaSourceApi extends {
    listWorkspaceFiles(
      token: string,
      sessionId: string,
      path: string,
    ): infer Result;
  }
    ? Result
    : never;
  readWorkspaceFile(
    token: string,
    sessionId: string,
    path: string,
  ): QaSourceApi extends {
    readWorkspaceFile(
      token: string,
      sessionId: string,
      path: string,
    ): infer Result;
  }
    ? Result
    : never;
  previewWorkspaceDocument(
    token: string,
    sessionId: string,
    path: string,
  ): QaSourceApi extends {
    previewWorkspaceDocument(
      token: string,
      sessionId: string,
      path: string,
    ): infer Result;
  }
    ? Result
    : never;
  pendingApprovals(
    token: string,
    sessionId: string,
  ): QaApprovalApi extends {
    pendingApprovals(token: string, sessionId: string): infer Result;
  }
    ? Result
    : never;
  pendingQuestions(
    token: string,
    sessionId: string,
  ): QaQuestionApi extends {
    pendingQuestions(token: string, sessionId: string): infer Result;
  }
    ? Result
    : never;
  answerQuestion(
    token: string,
    sessionId: string,
    requestId: string,
    answers: readonly QaQuestionAnswerItem[],
  ): QaQuestionApi extends {
    answerQuestion(
      token: string,
      sessionId: string,
      requestId: string,
      answers: readonly QaQuestionAnswerItem[],
    ): infer Result;
  }
    ? Result
    : never;
  cancelQuestion(
    token: string,
    sessionId: string,
    requestId: string,
  ): QaQuestionApi extends {
    cancelQuestion(
      token: string,
      sessionId: string,
      requestId: string,
    ): infer Result;
  }
    ? Result
    : never;
  answerApproval(
    token: string,
    sessionId: string,
    requestId: string,
    decision: QaApprovalDecision,
  ): QaApprovalApi extends {
    answerApproval(
      token: string,
      sessionId: string,
      requestId: string,
      decision: QaApprovalDecision,
    ): infer Result;
  }
    ? Result
    : never;
  accountsWhoami(token: string): Promise<RemoteResult<QaWhoamiResult>>;
  accountsLogin(
    email: string,
    password: string,
  ): Promise<RemoteResult<QaAccountSession>>;
  accountsRegister(
    email: string,
    password: string,
  ): Promise<RemoteResult<QaAccountSession>>;
  accountsClaimSessions(
    token: string,
    sessionIds: readonly string[],
  ): Promise<RemoteResult<QaClaimResult>>;
  accountsOwnedSessions(
    token: string,
  ): Promise<RemoteResult<{ readonly ids: readonly string[] }>>;
  accountsListOwnership(
    token: string,
  ): Promise<RemoteResult<{ readonly entries: readonly QaOwnershipEntry[] }>>;
  accessCurrent(token: string): Promise<RemoteResult<QaCurrentAccess>>;
  accessSession(
    token: string,
    sessionId: string,
  ): Promise<RemoteResult<QaSessionAccess>>;
  accessAdminSnapshot(
    token: string,
  ): Promise<RemoteResult<QaAccessAdminSnapshot>>;
  accessCreateSubrole(
    token: string,
    input: QaSubrole,
  ): Promise<RemoteResult<QaSubrole>>;
  accessUpdateSubrole(
    token: string,
    id: string,
    input: QaSubrole,
  ): Promise<RemoteResult<QaSubrole>>;
  accessDeleteSubrole(
    token: string,
    id: string,
    replacementId: string | null,
  ): Promise<RemoteResult<{ readonly deleted: boolean }>>;
  accessUpdateCommon(
    token: string,
    input: QaCapabilitySelection,
  ): Promise<RemoteResult<QaCapabilitySelection>>;
  accessUpdateAssignment(
    token: string,
    userId: string,
    input: QaUserAccess,
  ): Promise<RemoteResult<QaUserAccess>>;
  accessUpdateSkillOverride(
    token: string,
    input: QaSkillAssignmentOverride,
  ): Promise<RemoteResult<readonly QaSkillAssignmentOverride[]>>;
  accessSkillActivations(
    token: string,
    sessionId: string,
  ): Promise<RemoteResult<readonly QaSkillActivationRecord[]>>;
  skillsList(
    token: string,
  ): Promise<RemoteResult<{ readonly skills: readonly QaSkillSummary[] }>>;
  skillsGet(
    token: string,
    name: string,
  ): Promise<RemoteResult<QaSkillDocument>>;
  skillsCreate(
    token: string,
    input: QaSkillDraftInput,
  ): Promise<RemoteResult<QaSkillDocument>>;
  skillsUpdate(
    token: string,
    name: string,
    input: QaSkillDraftInput,
  ): Promise<RemoteResult<QaSkillDocument>>;
  skillsRemove(
    token: string,
    name: string,
    expectedRevision: string | null,
  ): Promise<RemoteResult<QaSkillRemoval>>;
  skillsTools(
    token: string,
  ): Promise<
    RemoteResult<{ readonly tools: readonly QaSkillToolDescriptor[] }>
  >;
  skillsValidate(
    token: string,
    name: string | null,
    input: QaSkillDraftInput,
  ): Promise<RemoteResult<QaSkillValidation>>;
  slashCatalog(
    token: string,
    sessionId: string,
  ): Promise<RemoteResult<QaSlashCatalog>>;
  slashExecute(
    token: string,
    sessionId: string,
    line: string,
    attachments: readonly QaSlashSubmitAttachment[],
  ): Promise<RemoteResult<QaSlashExecution>>;
}

/** The assembled Client Remote plus this plugin's own qaSurface namespace. */
type QaClientRemote = ClientRemote & { readonly qaSurface: QaPolicyRemote };

const QA_WELCOME_SLOT_ID = "welcome-notice";

/**
 * Priority of the kiosk root registration. 'root' is a single slot whose
 * lowest-priority entry renders, so this must sit below the ui-layout
 * fail-safe occupant's priority (1000 in the kiosk branch) — the surface
 * shadows the static error screen the moment it registers, and if this
 * registration never happens, the error screen is what the user sees instead
 * of a native shell.
 */
const QA_ROOT_OWNER_PRIORITY = -1000;

function qaWelcomeStorageKey(config: ResolvedQaSurfaceConfig): string {
  return `${qaStorageNamespace(config)}:welcome-notice`;
}

export const inject = [
  "slots",
  "sessions",
  "uiConversation",
  "connection",
  "settingsScope",
  "remote",
];

/** Register the route-aware, full-frame QA entry: root owner in the kiosk, additive overlay slot otherwise. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  // The presentation is a property of the deployment, published once in the
  // document prelude: kiosk = the surface owns the 'root' slot, overlay = the
  // surface covers the native shell from 'shell.overlay'. Read once here —
  // the prelude runs before any application script, so the answer is final
  // for this page load.
  const kiosk = qaKioskMode();
  const panels = new QaSurfacePanelRegistry();
  const settingsSections = new QaUserSettingsSectionRegistry();
  // Cards that mount outside the QA overlay (the host's plugin settings) read
  // the signed-in account through this service; the overlay's own controllers
  // stay the authority and attach to it below.
  const userSession = new QaUserSessionMirror();

  // The audit provider is an optional peer: its namespace is attached when the
  // audit plugin's client bundle is present and detached when it goes away.
  const audit = new QaAuditController();
  ctx.effect(() => () => audit.dispose(), "dsh-qa-surface: audit controller");
  ctx.effect(() => {
    const removeService = ctx.provide("qaSurfacePanels", panels);
    return () => {
      panels.dispose();
      void removeService();
    };
  }, "dsh-qa-surface: panel service");
  ctx.effect(() => {
    const removeService = ctx.provide(
      "qaUserSettingsSections",
      settingsSections,
    );
    return () => {
      settingsSections.dispose();
      void removeService();
    };
  }, "dsh-qa-surface: user settings extension service");
  ctx.effect(() => {
    const removeService = ctx.provide("qaUserSession", userSession);
    return () => {
      userSession.dispose();
      void removeService();
    };
  }, "dsh-qa-surface: user session service");
  const remote = ctx.remote as QaClientRemote;
  const disposeRemote = await remote.$mount(qaSurfaceRemote);
  await ctx.inject(
    ["remote.qaSurface", "remote.session", "remote.agentPresets"],
    (remoteContext) => {
      const injectedRemote = remoteContext.remote as QaClientRemote;

      // Absent audit plugin => this callback never runs => no badge, no
      // dialog, and nothing else about the surface changes (SPEC §48).
      remoteContext.inject(["remote.sessionAudit"], (auditContext) => {
        const mounted = auditContext.remote as unknown as {
          sessionAudit: QaAuditRemote;
        };
        audit.attach(createQaAuditApi(mounted.sessionAudit));
        return () => audit.detach();
      });
      // Keep source checks independent of a previously generated lib/ Remote
      // declaration. The handwritten face is the same contract the generator
      // validates during build.
      const policyRemote =
        injectedRemote.qaSurface as unknown as QaPolicyRemote;
      const secureSession: QaSecureSession = (token, sessionId) =>
        policyRemote.secureSession(
          token,
          sessionId,
        ) as unknown as ReturnType<QaSecureSession>;
      const qaApi: QaSessionsApi = {
        selectModel: (request) => injectedRemote.session.selectModel(request),
        selectAgentPreset: (agentId, agentPreset) =>
          injectedRemote.agentPresets.select(agentId, agentPreset),
      };
      const accessApi: QaAccessApi = {
        current: (token) => policyRemote.accessCurrent(token),
        session: (token, sessionId) =>
          policyRemote.accessSession(token, sessionId),
        admin: (token) => policyRemote.accessAdminSnapshot(token),
        createSubrole: (token, input) =>
          policyRemote.accessCreateSubrole(token, input),
        updateSubrole: (token, id, input) =>
          policyRemote.accessUpdateSubrole(token, id, input),
        deleteSubrole: (token, id, replacementId) =>
          policyRemote.accessDeleteSubrole(token, id, replacementId),
        updateCommon: (token, input) =>
          policyRemote.accessUpdateCommon(token, input),
        updateAssignment: (token, userId, input) =>
          policyRemote.accessUpdateAssignment(token, userId, input),
        updateSkillOverride: (token, input) =>
          policyRemote.accessUpdateSkillOverride(token, input),
        skillActivations: (token, sessionId) =>
          policyRemote.accessSkillActivations(token, sessionId),
      };
      const adminApi: QaAdminApi = {
        overview: (token) => policyRemote.adminOverview(token),
        users: (token, query, cursor, limit) =>
          policyRemote.adminUsers(token, query, cursor, limit),
        user: (token, userId) => policyRemote.adminUser(token, userId),
        updateUser: (token, userId, update) =>
          policyRemote.adminUpdateUser(token, userId, update),
        passwordResetRequests: (token) =>
          policyRemote.adminPasswordResetRequests(token),
        resetPassword: (token, userId, password) =>
          policyRemote.adminResetPassword(token, userId, password),
        conversations: (token, query, cursor, limit) =>
          policyRemote.adminConversations(token, query, cursor, limit),
        conversation: (token, conversationId) =>
          policyRemote.adminConversation(token, conversationId),
        deleteConversation: (token, conversationId) =>
          policyRemote.adminDeleteConversation(token, conversationId),
        feedback: (token, query, cursor, limit) =>
          policyRemote.adminFeedback(token, query, cursor, limit),
        rateMessage: (token, conversationId, messageId, input) =>
          policyRemote.adminRateMessage(
            token,
            conversationId,
            messageId,
            input,
          ),
        reviewQueue: (token, cursor, limit) =>
          policyRemote.adminReviewQueue(token, cursor, limit),
        queueConversation: (token, conversationId, messageId) =>
          policyRemote.adminQueueConversation(token, conversationId, messageId),
        saveReview: (token, input) =>
          policyRemote.adminSaveReview(token, input),
        metrics: (token) => policyRemote.adminMetrics(token),
        audit: (token, query, cursor, limit) =>
          policyRemote.adminAudit(token, query, cursor, limit),
        skills: (token, scope) => policyRemote.adminSkills(token, scope),
        skill: (token, scope, name) =>
          policyRemote.adminSkill(token, scope, name),
        saveSkill: (token, scope, name, input) =>
          policyRemote.adminSkillSave(token, scope, name, input),
        deleteSkill: (token, scope, name, expectedRevision) =>
          policyRemote.adminSkillDelete(token, scope, name, expectedRevision),
        validateSkill: (token, scope, name, input) =>
          policyRemote.adminSkillValidate(token, scope, name, input),
        skillTools: async (token, scope) => {
          const result = await policyRemote.adminSkillTools(token, scope);
          return result.ok
            ? { ok: true, value: result.value.tools }
            : { ok: false, error: result.error };
        },
      };
      const sourceApi: QaSourceApi = {
        sources: (token, sessionId) =>
          policyRemote.sources(token, sessionId) as unknown as ReturnType<
            QaSourceApi["sources"]
          >,
        readSourceFile: (token, sessionId, sourcePath) =>
          policyRemote.readSourceFile(
            token,
            sessionId,
            sourcePath,
          ) as unknown as ReturnType<QaSourceApi["readSourceFile"]>,
        listWorkspaceFiles: (token, sessionId, path) =>
          policyRemote.listWorkspaceFiles(
            token,
            sessionId,
            path,
          ) as unknown as ReturnType<QaSourceApi["listWorkspaceFiles"]>,
        readWorkspaceFile: (token, sessionId, path) =>
          policyRemote.readWorkspaceFile(
            token,
            sessionId,
            path,
          ) as unknown as ReturnType<QaSourceApi["readWorkspaceFile"]>,
        previewWorkspaceDocument: (token, sessionId, path) =>
          policyRemote.previewWorkspaceDocument(
            token,
            sessionId,
            path,
          ) as unknown as ReturnType<QaSourceApi["previewWorkspaceDocument"]>,
      };
      const questionApi: QaQuestionApi = {
        pendingQuestions: (token, sessionId) =>
          policyRemote.pendingQuestions(
            token,
            sessionId,
          ) as unknown as ReturnType<QaQuestionApi["pendingQuestions"]>,
        answerQuestion: (token, sessionId, requestId, answers) =>
          policyRemote.answerQuestion(
            token,
            sessionId,
            requestId,
            answers,
          ) as unknown as ReturnType<QaQuestionApi["answerQuestion"]>,
        cancelQuestion: (token, sessionId, requestId) =>
          policyRemote.cancelQuestion(
            token,
            sessionId,
            requestId,
          ) as unknown as ReturnType<QaQuestionApi["cancelQuestion"]>,
      };
      // Personal skills: the token rides every call, and the Host answers with
      // the caller's own storage. The section simply does not exist on a page
      // whose deployment cannot host one.
      const skillApi: QaSkillApi = {
        skillsList: (token) => policyRemote.skillsList(token),
        skillsGet: (token, name) => policyRemote.skillsGet(token, name),
        skillsCreate: (token, input) => policyRemote.skillsCreate(token, input),
        skillsUpdate: (token, name, input) =>
          policyRemote.skillsUpdate(token, name, input),
        skillsRemove: (token, name, expectedRevision) =>
          policyRemote.skillsRemove(token, name, expectedRevision),
        skillsTools: (token) => policyRemote.skillsTools(token),
        skillsValidate: (token, name, input) =>
          policyRemote.skillsValidate(token, name, input),
      };
      const approvalApi: QaApprovalApi = {
        pendingApprovals: (token, sessionId) =>
          policyRemote.pendingApprovals(
            token,
            sessionId,
          ) as unknown as ReturnType<QaApprovalApi["pendingApprovals"]>,
        answerApproval: (token, sessionId, requestId, decision) =>
          policyRemote.answerApproval(
            token,
            sessionId,
            requestId,
            decision,
          ) as unknown as ReturnType<QaApprovalApi["answerApproval"]>,
      };
      const slashApi: QaSlashApi = {
        catalog: (token, sessionId) =>
          policyRemote.slashCatalog(token, sessionId),
        execute: (token, sessionId, line, attachments) =>
          policyRemote.slashExecute(token, sessionId, line, attachments),
      };
      // The account gate rides its own remote; a stale token simply answers
      // "not authenticated" and the browser shows the login card.
      const accounts = new QaAccountsController({
        remote: policyRemote,
        storage: window.localStorage,
        config: () => config.getSnapshot().config,
        legacyChatIds: () => {
          // A standalone index view over the same prefix: reads the chat ids
          // this browser accumulated before accounts existed. A delegated
          // child an older release left in that index is not a chat, so it is
          // never offered as something to claim.
          const snapshot = config.getSnapshot().config;
          const index = new QaChatIndex(
            window.localStorage,
            qaStorageNamespace(snapshot),
          );
          const summaries = (
            ctx.sessions as unknown as QaSessions | undefined
          )?.list.getSnapshot().byId;
          const isChild = (id: string): boolean =>
            summaries === undefined
              ? false
              : isDelegatedSession(summaries[id as SessionId]);
          const ids = index.chatIds().filter((id) => !isChild(id));
          const active = index.activeId();
          if (active !== null && !ids.includes(active) && !isChild(active)) {
            ids.push(active);
          }
          return ids;
        },
        forgetChat: (sessionId) => {
          const snapshot = config.getSnapshot().config;
          new QaChatIndex(
            window.localStorage,
            qaStorageNamespace(snapshot),
          ).forgetChat(sessionId);
        },
      });
      // Publish the account this controller tracks to the extension service, so
      // a card mounted outside the overlay sees the same session the pages do.
      userSession.attach(accounts);
      const route = new QaRouteController();
      // One binding for both readers: the surface projects it into the page's
      // configuration, the settings card edits the same namespace through it.
      const settingsScope = (
        ctx.settingsScope as SettingsScopeBinder
      ).bind<QaSurfaceConfig>({
        namespace: QA_SURFACE_SETTINGS_NAMESPACE,
      });
      const config = new QaConfigController(settingsScope, async () => {
        // Settings RPCs are loopback-pinned by the gateway, so a browser the
        // Host serves over the LAN reads the effective configuration here.
        const described = await policyRemote.describe();
        if (!described.ok) {
          throw new Error(`qaSurface/describe failed: ${described.error.code}`);
        }
        // The generated self-remote resolves through the previous build's
        // declarations during an incremental source typecheck.
        return described.value as unknown as ResolvedQaSurfaceConfig;
      });
      // The operator edits this deployment through the shared plugin-cards
      // tab: the same namespace the page reads, plus the Host's own answer
      // about what it resolved. Its stylesheet is the card shell, not the QA
      // page's palette.
      ctx.effect(() => {
        const cardFace: QaSettingsCardFace = {
          scope: settingsScope,
          describe: () => policyRemote.describe(),
        };
        return registerSettingsCard(remoteContext, {
          key: QA_SURFACE_SETTINGS_NAMESPACE,
          pluginName: "@yadsh/dsh-qa-surface",
          styles: QA_SETTINGS_STYLES,
          component: QaSettingsCard,
          inject: () => cardFace,
        });
      }, "dsh-qa-surface: settings-card");
      const syncRoute = () => {
        const snapshot = config.getSnapshot();
        // Kiosk: the harness route policy serves the application under the
        // base path it published in the prelude, so the route the page
        // matches is that path — the plugin config row is the overlay
        // composition's setting and would diverge from the server policy.
        const effective = kiosk
          ? {
              ...snapshot.config,
              route: { path: qaKioskBasePath(), matchChildren: true },
            }
          : snapshot.config;
        route.configure(
          effective,
          snapshot.status === "ready" || snapshot.status === "unavailable",
        );
      };
      syncRoute();
      const unsubscribeConfig = config.subscribe(syncRoute);
      // After a Host restart an open page must re-read the deployment config,
      // or the next attestation compares its proof against a stale copy and
      // refuses. Loopback pages follow the settings mirror; this covers the
      // describe fallback (LAN browsers). Fires on every lost→restored
      // connection transition; while connected, ticks are ignored.
      let connectionUp = ctx.connection.generation.getSnapshot() !== undefined;
      const unsubscribeConnection = ctx.connection.generation.subscribe(() => {
        const connected = ctx.connection.generation.getSnapshot() !== undefined;
        if (connected && !connectionUp) {
          config.refreshFallback();
          // A boot-time whoami may have raced the lost connection; the
          // controller no-ops unless it is still in the checking stage.
          void accounts.start();
        }
        connectionUp = connected;
      });
      void accounts.start();

      // The stock DSH welcome notice cannot persist its acknowledgement for
      // non-loopback browsers. Shadow only its list-slot cell while the QA
      // route is selected; leaving /qa immediately restores the host entry.
      ctx.slots.inject("settings.onboarding", () => {
        let removeEntry: (() => void) | undefined;
        let mountedKey: string | undefined;
        const reconcile = () => {
          const configSnapshot = config.getSnapshot().config;
          const routeSnapshot = route.getSnapshot();
          const active =
            configSnapshot.enabled &&
            matchesQaRoute(routeSnapshot.pathname, configSnapshot.route);
          const nextKey = active
            ? qaWelcomeStorageKey(configSnapshot)
            : undefined;
          if (nextKey === mountedKey) return;
          removeEntry?.();
          removeEntry = undefined;
          mountedKey = nextKey;
          if (nextKey === undefined) return;
          removeEntry = ctx.slots.register(
            {
              name: "settings.onboarding",
              id: QA_WELCOME_SLOT_ID,
              order: -100,
              priority: -1_000,
              inject: () => ({
                storage: window.localStorage,
                storageKey: nextKey,
              }),
            },
            QaWelcomeNoticeStep,
          );
        };
        reconcile();
        const unsubscribeRoute = route.subscribe(reconcile);
        const unsubscribeConfig = config.subscribe(reconcile);
        return () => {
          unsubscribeRoute();
          unsubscribeConfig();
          removeEntry?.();
        };
      });

      ctx.effect(() => {
        const style = document.createElement("style");
        style.dataset.dshQaSurface = "styles";
        // The kiosk sheet carries no host-hiding rules: nothing native mounts
        // beneath the surface in that composition, so there is nothing to hide.
        style.textContent = kiosk ? QA_ROOT_STYLES : QA_OVERLAY_STYLES;
        document.head.append(style);
        return () => style.remove();
      }, "dsh-qa-surface: styles");

      ctx.effect(
        () => () => {
          unsubscribeConfig();
          unsubscribeConnection();
          config.dispose();
          route.dispose();
        },
        "dsh-qa-surface: controllers",
      );

      // The face both presentations hand to the guard. Read host services
      // lazily (cordis service visibility), so assembly can fail here — the
      // guard then renders the failure card instead of the entry crashing.
      const qaFace = (): QaSurfaceFace => {
        try {
          return {
            route,
            config,
            // The host dsh-session merge types ctx.sessions as SessionStore in
            // this program; the client assembly provides the ISessions face.
            sessions: ctx.sessions as unknown as QaSessions,
            conversation: ctx.uiConversation,
            api: qaApi,
            connection: ctx.connection.generation,
            secureSession,
            createSession: (
              token: string,
              subroleId: string | null,
              adminPreview: boolean,
            ) => policyRemote.createSession(token, subroleId, adminPreview),
            accessApi,
            adminApi,
            sourceApi,
            skillApi,
            approvalApi,
            questionApi,
            slashApi,
            accounts,
            panels,
            settingsSections,
            audit,
            // The upload service is optional on the page: a deployment that
            // does not serve it keeps images, and a staged file refuses the
            // send with a message instead of losing the draft. Read through
            // the untyped service lookup on purpose — the QA bundle does not
            // link the upload package.
            fileUpload: () =>
              (
                ctx as unknown as {
                  get(service: string): unknown;
                }
              ).get("fileUpload") as QaFileUpload | undefined,
          };
        } catch {
          return {} as QaSurfaceFace;
        }
      };

      if (kiosk) {
        // The kiosk composition: the surface IS the application. Registering
        // into 'root' (the runtime's single root slot) shadows the host's
        // fail-safe occupant — a static error screen the ui-layout kiosk
        // branch holds at a higher priority exactly for the case where this
        // registration never happens. The panel seat is declared here so the
        // extension panels keep resolving under the root owner.
        //
        // The call MUST stay attached to ctx.slots: the register
        // implementation is a prototype function reading this.ctx (bound by
        // the cordis service proxy at property-access time), so extracting
        // it into a variable lands in a fiber-less context and throws. This
        // program's type contract does not know the root's children seat
        // (that is the host program's knowledge), hence the argument casts —
        // they widen the arguments, never detach the receiver.
        ctx.slots.register(
          {
            name: "root",
            priority: QA_ROOT_OWNER_PRIORITY,
            children: {
              "qa.surface.panel": { kind: "keyed", scope: "root" },
            },
            inject: qaFace,
          } as unknown as Parameters<typeof ctx.slots.register>[0],
          QaSurfaceGuard as unknown as Parameters<typeof ctx.slots.register>[1],
        );
      } else {
        ctx.slots.inject("shell.overlay", () =>
          ctx.slots.register(
            {
              name: "shell.overlay",
              id: "dsh-qa-surface",
              order: -10_000,
              children: {
                "qa.surface.panel": { kind: "keyed", scope: "root" },
              },
              inject: qaFace,
            },
            QaSurfaceGuard,
          ),
        );
      }
    },
  );
  return disposeRemote;
}

export { QaConfigController } from "./QaConfigController.js";
export { QaAccountsController } from "./QaAccountsController.js";
export { QaRouteController, matchesQaRoute } from "./QaRouteController.js";
export { QaSessionController } from "./QaSessionController.js";
export { projectTranscript } from "./QaTranscriptAdapter.js";
export type {
  QaSurfacePanelDefinition,
  QaSurfacePanelOpenOptions,
  QaSurfacePanelOwnerProps,
  QaSurfacePanelPresentation,
  QaSurfacePanels,
} from "./panels/contract.js";
