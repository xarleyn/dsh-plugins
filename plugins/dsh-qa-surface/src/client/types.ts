import type { ClientRemote } from "@deepseek-ai/dsh-api-gateway/client";
import type {
  ISessions,
  SessionFace,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-api-session-controller/remote";
import type {} from "@deepseek-ai/dsh-agent-presets/remote";
import type { UiConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  QaAccountProfileInput,
  QaAccountSession,
  QaAccountStartersInput,
  QaAccountStarter,
  QaAccountUserPublic,
  QaAccessAdminSnapshot,
  QaApprovalDecision,
  QaClaimResult,
  QaLockdownProof,
  QaOwnershipEntry,
  QaPendingApproval,
  QaPendingQuestion,
  QaQuestionAnswerItem,
  QaIssuedServiceToken,
  QaServiceTokenCreateInput,
  QaServiceTokenSummary,
  QaSessionState,
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillRemoval,
  QaSkillSummary,
  QaSkillToolDescriptor,
  QaSkillValidation,
  QaSourceFilePreview,
  QaTurnSources,
  QaWhoamiResult,
  QaDocumentPreview,
  QaWorkspaceFile,
  QaWorkspaceListing,
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
  QaQualityMetrics,
  QaReviewQueueItem,
  QaReviewQueueRow,
  QaSlashCatalog,
  QaSlashExecution,
  QaSlashSubmitAttachment,
  QaUserQuery,
} from "../types.js";

/** Wire content one prompt carries: text plus base64 image uploads. */
export type QaPromptContent = Parameters<SessionFace["prompt"]>[0];

/** DSH session runtime surface the QA controller is allowed to touch. */
export type QaSessions = ISessions;

/** Narrow client API slice used to pin the preset and model of a fresh chat. */
export type QaSessionsApi = {
  selectModel: ClientRemote["session"]["selectModel"];
  selectAgentPreset: ClientRemote["agentPresets"]["select"];
};

/**
 * Conversation assembly the QA transcript is projected from: the per-Session
 * binding carries the assembled Chat view (nodes, partials, tool calls).
 */
export type QaConversation = Pick<UiConversation, "binding">;

/**
 * Attestation channel to the Host admission boundary
 * (`qaSurface/secureSession`). The account token rides as the first argument
 * when accounts are enabled; an empty string is the anonymous caller.
 */
export type QaSecureSession = (
  token: string,
  sessionId: string,
) => Promise<
  | { readonly ok: true; readonly value: QaLockdownProof }
  | { readonly ok: false; readonly error: unknown }
>;

/** Host-authoritative creation: identity, cwd and policy never come from the browser. */
export type QaCreateSession = (
  token: string,
  subroleId: string | null,
  adminPreview: boolean,
) => Promise<RemoteResult<string>>;

/** Role selector plus administrator mutation channel. */
export interface QaAccessApi {
  current(token: string): Promise<RemoteResult<QaCurrentAccess>>;
  session(
    token: string,
    sessionId: string,
  ): Promise<RemoteResult<QaSessionAccess>>;
  admin(token: string): Promise<RemoteResult<QaAccessAdminSnapshot>>;
  createSubrole(
    token: string,
    input: QaSubrole,
  ): Promise<RemoteResult<QaSubrole>>;
  updateSubrole(
    token: string,
    id: string,
    input: QaSubrole,
  ): Promise<RemoteResult<QaSubrole>>;
  deleteSubrole(
    token: string,
    id: string,
    replacementId: string | null,
  ): Promise<RemoteResult<{ readonly deleted: boolean }>>;
  updateCommon(
    token: string,
    input: QaCapabilitySelection,
  ): Promise<RemoteResult<QaCapabilitySelection>>;
  updateAssignment(
    token: string,
    userId: string,
    input: QaUserAccess,
  ): Promise<RemoteResult<QaUserAccess>>;
  updateSkillOverride(
    token: string,
    input: QaSkillAssignmentOverride,
  ): Promise<RemoteResult<readonly QaSkillAssignmentOverride[]>>;
  skillActivations(
    token: string,
    sessionId: string,
  ): Promise<RemoteResult<readonly QaSkillActivationRecord[]>>;
}

/**
 * The administrative console's wire surface. Every call carries the caller's
 * token and nothing else identifying: the Host resolves the actor, checks the
 * permission the method needs and answers with the audience-safe refusal code
 * the page renders.
 */
export interface QaAdminApi {
  overview(token: string): Promise<RemoteResult<QaAdminOverview>>;
  users(
    token: string,
    query: QaUserQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<RemoteResult<QaAdminPage<QaAdminUserRow>>>;
  user(token: string, userId: string): Promise<RemoteResult<QaAdminUserDetail>>;
  updateUser(
    token: string,
    userId: string,
    update: QaAdminUserUpdate,
  ): Promise<RemoteResult<QaAdminUserDetail>>;
  conversations(
    token: string,
    query: QaConversationQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<RemoteResult<QaAdminPage<QaConversationSummary>>>;
  conversation(
    token: string,
    conversationId: string,
  ): Promise<RemoteResult<QaConversationDetail>>;
  /**
   * Remove the conversation from the deployment, stored logs included. Only an
   * administrator may call it; the sidebar's own delete is unrelated.
   */
  deleteConversation(
    token: string,
    conversationId: string,
  ): Promise<RemoteResult<QaConversationDeletion>>;
  feedback(
    token: string,
    query: QaFeedbackQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<RemoteResult<QaAdminPage<QaFeedbackRow>>>;
  /** The signed-in user's own verdict on one of their assistant messages. */
  rateMessage(
    token: string,
    conversationId: string,
    messageId: string,
    input: QaMessageFeedbackInput,
  ): Promise<RemoteResult<QaMessageFeedback>>;
  reviewQueue(
    token: string,
    cursor: string | null,
    limit: number | null,
  ): Promise<RemoteResult<QaAdminPage<QaReviewQueueRow>>>;
  queueConversation(
    token: string,
    conversationId: string,
    messageId: string | null,
  ): Promise<RemoteResult<QaReviewQueueItem>>;
  saveReview(
    token: string,
    input: QaConversationReviewInput,
  ): Promise<RemoteResult<QaConversationReview>>;
  metrics(token: string): Promise<RemoteResult<QaQualityMetrics>>;
  audit(
    token: string,
    query: QaAuditQuery,
    cursor: string | null,
    limit: number | null,
  ): Promise<RemoteResult<QaAdminPage<QaAdminAuditEvent>>>;
}

/**
 * Browser file-upload service (`ctx.fileUpload`), described structurally on
 * purpose: files do not ride the prompt inline the way images do, they are
 * staged through the Host upload route and cited by receipt. The QA bundle
 * must not link the upload package — a deployment may not serve it — so the
 * service is read off the context at send time and this is the only shape the
 * surface relies on.
 */
export interface QaFileUpload {
  upload(
    sessionId: string,
    data: Blob | Uint8Array,
    name?: string,
    signal?: AbortSignal,
  ): Promise<
    | {
        readonly ok: true;
        readonly value: {
          readonly receiptId: string;
          readonly file: {
            readonly attachmentId: string;
            readonly name: string;
            readonly bytes: number;
          };
        };
      }
    | { readonly ok: false; readonly error: unknown }
  >;
}

export interface QaSourceApi {
  sources(
    token: string,
    sessionId: string,
  ): Promise<
    | { readonly ok: true; readonly value: readonly QaTurnSources[] }
    | { readonly ok: false; readonly error: unknown }
  >;
  readSourceFile(
    token: string,
    sessionId: string,
    sourcePath: string,
  ): Promise<
    | { readonly ok: true; readonly value: QaSourceFilePreview }
    | { readonly ok: false; readonly error: unknown }
  >;
  /** One directory of the chat's own workspace, for the files panel. */
  listWorkspaceFiles(
    token: string,
    sessionId: string,
    path: string,
  ): Promise<
    | { readonly ok: true; readonly value: QaWorkspaceListing }
    | { readonly ok: false; readonly error: unknown }
  >;
  /** One file of that workspace: decoded text, or bytes when it is binary. */
  readWorkspaceFile(
    token: string,
    sessionId: string,
    path: string,
  ): Promise<
    | { readonly ok: true; readonly value: QaWorkspaceFile }
    | { readonly ok: false; readonly error: unknown }
  >;
  /**
   * A Word document of that workspace rendered as PDF by the deployment's
   * document pipeline; the panel shows the PDF the browser already knows how
   * to draw instead of uploading the bytes anywhere.
   */
  previewWorkspaceDocument(
    token: string,
    sessionId: string,
    path: string,
  ): Promise<
    | { readonly ok: true; readonly value: QaDocumentPreview }
    | { readonly ok: false; readonly error: unknown }
  >;
}

/**
 * The slash half of the Host namespace. The catalog comes back already cut
 * down by the deployment policy and the chat's role; `execute` takes the raw
 * line, because admission re-derives the name from it rather than trusting
 * anything the browser says about which entry it means.
 */
export interface QaSlashApi {
  catalog(
    token: string,
    sessionId: string,
  ): Promise<RemoteResult<QaSlashCatalog>>;
  execute(
    token: string,
    sessionId: string,
    line: string,
    attachments: readonly QaSlashSubmitAttachment[],
  ): Promise<RemoteResult<QaSlashExecution>>;
}

/** A source API with the account token already bound at the call site. */
export type QaBoundSourceApi = {
  sources(
    sessionId: string,
  ): Promise<
    | { readonly ok: true; readonly value: readonly QaTurnSources[] }
    | { readonly ok: false; readonly error: unknown }
  >;
  readSourceFile(
    sessionId: string,
    sourcePath: string,
  ): Promise<
    | { readonly ok: true; readonly value: QaSourceFilePreview }
    | { readonly ok: false; readonly error: unknown }
  >;
  listWorkspaceFiles(
    sessionId: string,
    path: string,
  ): Promise<
    | { readonly ok: true; readonly value: QaWorkspaceListing }
    | { readonly ok: false; readonly error: unknown }
  >;
  readWorkspaceFile(
    sessionId: string,
    path: string,
  ): Promise<
    | { readonly ok: true; readonly value: QaWorkspaceFile }
    | { readonly ok: false; readonly error: unknown }
  >;
  previewWorkspaceDocument(
    sessionId: string,
    path: string,
  ): Promise<
    | { readonly ok: true; readonly value: QaDocumentPreview }
    | { readonly ok: false; readonly error: unknown }
  >;
};

/**
 * Approval remotes of this plugin's namespace. Read-only listing plus the one
 * write: the operator's answer to a parked tool call.
 */
export interface QaApprovalApi {
  pendingApprovals(
    token: string,
    sessionId: string,
  ): Promise<
    | { readonly ok: true; readonly value: readonly QaPendingApproval[] }
    | { readonly ok: false; readonly error: unknown }
  >;
  answerApproval(
    token: string,
    sessionId: string,
    requestId: string,
    decision: QaApprovalDecision,
  ): Promise<
    | { readonly ok: true; readonly value: boolean }
    | { readonly ok: false; readonly error: unknown }
  >;
}

/**
 * Question remotes of this plugin's namespace: the parked `ask_user_question`
 * requests of one chat, the operator's answers, and closing one unanswered.
 */
export interface QaQuestionApi {
  pendingQuestions(
    token: string,
    sessionId: string,
  ): Promise<
    | { readonly ok: true; readonly value: readonly QaPendingQuestion[] }
    | { readonly ok: false; readonly error: unknown }
  >;
  answerQuestion(
    token: string,
    sessionId: string,
    requestId: string,
    answers: readonly QaQuestionAnswerItem[],
  ): Promise<
    | { readonly ok: true; readonly value: boolean }
    | { readonly ok: false; readonly error: unknown }
  >;
  cancelQuestion(
    token: string,
    sessionId: string,
    requestId: string,
  ): Promise<
    | { readonly ok: true; readonly value: boolean }
    | { readonly ok: false; readonly error: unknown }
  >;
}

/**
 * Personal-skill remotes of this plugin's namespace. The browser names a
 * skill, never a directory: the account token behind the call decides where
 * that name resolves.
 */
export interface QaSkillApi {
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
}

/** The skill API with the account token already bound at the call site. */
export interface QaBoundSkillApi {
  list(): Promise<RemoteResult<readonly QaSkillSummary[]>>;
  get(name: string): Promise<RemoteResult<QaSkillDocument>>;
  create(input: QaSkillDraftInput): Promise<RemoteResult<QaSkillDocument>>;
  update(
    name: string,
    input: QaSkillDraftInput,
  ): Promise<RemoteResult<QaSkillDocument>>;
  remove(
    name: string,
    expectedRevision: string | null,
  ): Promise<RemoteResult<QaSkillRemoval>>;
  tools(): Promise<RemoteResult<readonly QaSkillToolDescriptor[]>>;
  validate(
    name: string | null,
    input: QaSkillDraftInput,
  ): Promise<RemoteResult<QaSkillValidation>>;
}

/**
 * Outcome of one integration-token operation as the settings page sees it:
 * the value, or the audience-safe copy for the refusal. The page renders the
 * copy and never has to know a reason code.
 */
export type QaIntegrationTokenResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: string };

/** The integration-token section with the account token bound at the call site. */
export interface QaIntegrationTokenApi {
  /**
   * Whether this deployment can mint at all. A token is a credential for the
   * HTTP API, so when that API is off the page explains the state instead of
   * offering a button that only ever refuses — while listing and revoking stay
   * available, because a credential has to remain revocable.
   */
  readonly canCreate: boolean;
  list(): Promise<QaIntegrationTokenResult<readonly QaServiceTokenSummary[]>>;
  create(
    input: QaServiceTokenCreateInput,
  ): Promise<QaIntegrationTokenResult<QaIssuedServiceToken>>;
  revoke(tokenId: string): Promise<QaIntegrationTokenResult<null>>;
}

/** Account remotes exposed by the plugin's own typert namespace. */
export interface QaAccountsApi {
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
  /** Replace the caller's own self-declared profile; the token is the identity. */
  accountsUpdateProfile(
    token: string,
    input: QaAccountProfileInput,
  ): Promise<RemoteResult<QaAccountUserPublic>>;
  /** Replace the caller's own starter buttons; the token is the identity. */
  accountsUpdateStarters(
    token: string,
    input: QaAccountStartersInput,
  ): Promise<RemoteResult<QaAccountUserPublic>>;
  /** The caller's own integration tokens; never a secret. */
  accountsListServiceTokens(token: string): Promise<
    RemoteResult<{
      readonly tokens: readonly QaServiceTokenSummary[];
    }>
  >;
  /** Mint one integration token for the caller; the plaintext comes back once. */
  accountsCreateServiceToken(
    token: string,
    input: QaServiceTokenCreateInput,
  ): Promise<RemoteResult<QaIssuedServiceToken>>;
  /** Revoke one of the caller's own integration tokens. */
  accountsRevokeServiceToken(
    token: string,
    tokenId: string,
  ): Promise<RemoteResult<{ readonly revoked: boolean }>>;
}

/** One button above an empty composer: what it reads and what it sends. */
export type QaQuickQuestion = QaAccountStarter;

/** Result shape every generated remote call resolves to. */
export type RemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: unknown };

/** Minimal persistence contract; backed by `window.localStorage` in the app. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The state projected while no QA chat is bound (route inactive or booting). */
export const QA_SESSION_IDLE_STATE: QaSessionState = Object.freeze({
  phase: "idle",
  sessionId: null,
  messages: Object.freeze([]),
  pendingMessage: null,
  error: null,
  compatibilityReadOnly: false,
  canSend: false,
  canStop: false,
  chatsRevision: 0,
  sources: Object.freeze([]),
  sourcesComplete: true,
  incompleteSourceOrigins: undefined,
  viewingSubagent: null,
  approvals: Object.freeze([]),
  questions: Object.freeze([]),
  // Idle means no chat, so there is nothing for a slash line to act on; the
  // controller fills this in once a session binds.
  slash: Object.freeze({
    enabled: false,
    state: "idle",
    entries: Object.freeze([]),
    commandSurface: "unavailable",
    deniedSkills: Object.freeze([]),
    error: null,
    reopen: 0,
  }),
});
