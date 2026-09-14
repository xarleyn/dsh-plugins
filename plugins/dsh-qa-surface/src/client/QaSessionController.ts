import type {
  ConnectionGenerationState,
  SessionId,
} from "@deepseek-ai/dsh-client-connection/client";
import type { SessionFace } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ConversationBinding } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { bytesToBase64 } from "./base64.js";
import { qaStorageNamespace } from "../shared/session-key.js";
import type {
  QaAttachmentDraft,
  QaFileDraft,
  QaPendingUserMessage,
  QaSessionState,
  QaSubagentView,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import { QaPolicyAttestationError } from "./attestation.js";
import { QaChatIndex } from "./chat-index.js";
import { SessionAssetRepository } from "./session-assets.js";
import { createQaSession } from "./create-session.js";
import { buildQaPromptContent, stageQaFiles } from "./prompt-content.js";
import { attestQaPolicy } from "./session-admission.js";
import { QaHostSourceBridge } from "./session-sources.js";
import { QaHostApprovalBridge } from "./approvals.js";
import { QaHostQuestionBridge } from "./questions.js";
import { StreamPublisher } from "./stream-publisher.js";
import type {
  QaApprovalApi,
  QaConversation,
  QaCreateSession,
  QaFileUpload,
  QaSecureSession,
  QaSessions,
  QaSessionsApi,
  QaQuestionApi,
  QaSourceApi,
  StorageLike,
} from "./types.js";
import { QA_SESSION_IDLE_STATE } from "./types.js";
import type { QaApprovalDecision, QaQuestionAnswerItem } from "../types.js";
import { waitFor } from "./wait-for.js";
import { QA_REGENERATE_MARKER } from "./QaTranscriptAdapter.js";
import { projectBoundSessionState } from "./project-session-state.js";
import { projectTurnSources } from "./turn-sources.js";

export interface QaAccountsFacade {
  /** The account bearer token, or null while anonymous. */
  readonly token: () => string | null;
  /** Server-owned chat ids; the list authority while accounts are on. */
  readonly ownedIds: () => readonly string[];
  /**
   * The chat owner's display name for author labels; admins see it on
   * foreign chats only, everyone else gets undefined.
   */
  readonly messageAuthorOf: (sessionId: string) => string | undefined;
  /** Called after a new chat binds, so ownership stays current. */
  readonly onSessionCreated: (sessionId: string) => void;
  /** Called when the Host refuses with auth-required (expired/rotated). */
  readonly onAuthRequired: () => void;
}

export interface QaSessionControllerOptions {
  readonly sessions: QaSessions;
  readonly api: QaSessionsApi;
  readonly createSession: QaCreateSession;
  /** Conversation assembly feeding the transcript projection. */
  readonly conversation: QaConversation;
  readonly connection: ConnectionGenerationState;
  readonly config: ResolvedQaSurfaceConfig;
  readonly secureSession: QaSecureSession;
  readonly sourceApi?: QaSourceApi;
  /**
   * The approval half of the Host namespace. Absent on a page built against a
   * Host that does not answer approvals: the surface then never shows a
   * request and keeps the composer as it is.
   */
  readonly approvalApi?: QaApprovalApi;
  /**
   * The question half of the Host namespace. Absent on a page whose Host build
   * does not answer questions: the surface then only renders what it can.
   */
  readonly questionApi?: QaQuestionApi;
  readonly storage?: StorageLike;
  /**
   * Browser file-upload service, resolved lazily: the page may not serve the
   * upload plugin, and a deployment without it keeps images and text only.
   */
  readonly fileUpload?: () => QaFileUpload | undefined;
  /** Present while the deployment gates QA users with accounts. */
  readonly accounts?: QaAccountsFacade;
  readonly timeoutMs?: number;
  /**
   * Minimum spacing between projections of a running turn's stream frames.
   * The host runtime already batches deltas to one notification per
   * animation frame; this ceiling keeps the render path flat on long
   * transcripts and weak hardware. Zero disables the spacing.
   */
  readonly streamIntervalMs?: number;
}

const CONFIGURATION_ERROR = "Настройки помощника недоступны.";

/**
 * Spacing of the parked-request poll. A request is answered by a person, so a
 * second of latency is invisible; the poll only runs while a turn runs.
 */
const PENDING_POLL_MS = 1_000;

interface PendingSubmission {
  readonly message: QaPendingUserMessage;
  /** Number of durable user rows present before this send started. */
  baselineUserCount: number;
  accepted: boolean;
  /** Lets a completed Host turn retire the optimistic row even if Chat lagged. */
  sawRunning: boolean;
}

/**
 * The only module that couples QA behavior to DSH Session/client APIs. It owns
 * the chat lifecycle state machine; the observable wait, browser-local chat
 * bookkeeping and policy-attestation details live in their own modules.
 */
export class QaSessionController {
  private readonly listeners = new Set<() => void>();
  private readonly sessions: QaSessions;
  private readonly createSessionRemote: QaCreateSession;
  private readonly conversation: QaConversation;
  private readonly connection: ConnectionGenerationState;
  private readonly config: ResolvedQaSurfaceConfig;
  private readonly secureSessionRemote: QaSecureSession;
  private readonly sourceApi: QaSourceApi;
  private readonly chats: QaChatIndex;
  private readonly accounts: QaAccountsFacade | undefined;
  /** Resolved per send: a page without the upload plugin has no receipts. */
  private readonly fileUpload: () => QaFileUpload | undefined;
  /** Per-chat attachment URL cache; blob URLs die with the chat binding. */
  private readonly assets = new SessionAssetRepository();
  private readonly timeoutMs: number;
  /** Spacing for a running turn's stream frames; the policy lives there. */
  private readonly streamPublisher: StreamPublisher;
  private state: QaSessionState = QA_SESSION_IDLE_STATE;
  private session: SessionFace | undefined;
  private conversationBinding: ConversationBinding | undefined;
  private unsubscribeSession: (() => void) | undefined;
  private unsubscribeChat: (() => void) | undefined;
  private readonly unsubscribeConnection: () => void;
  private ensuring: Promise<void> | undefined;
  private materializing: Promise<boolean> | undefined;
  private operationError: string | null = null;
  private admissionPending = false;
  private pendingSubmission: PendingSubmission | undefined;
  private pendingSequence = 0;
  private policyReady = false;
  private drafting = false;
  /** The chat session to return to when a subagent view closes. */
  private chatSessionId: string | null = null;
  private viewingSubagent: QaSubagentView | null = null;
  private connectedOnce: boolean;
  private disposed = false;
  private generation = 0;
  private chatsRevision = 0;
  /** Host-side provenance of the bound chat, merged into the projection. */
  private readonly hostSources: QaHostSourceBridge;
  /** Host-side approvals of the bound chat waiting for the operator. */
  private readonly hostApprovals: QaHostApprovalBridge;
  /** Host-side question requests of the bound chat waiting for the operator. */
  private readonly hostQuestions: QaHostQuestionBridge;
  /** Set while a running turn is polled for parked requests. */
  private pendingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: QaSessionControllerOptions) {
    this.sessions = options.sessions;
    this.createSessionRemote = options.createSession;
    this.conversation = options.conversation;
    this.connection = options.connection;
    this.config = options.config;
    this.secureSessionRemote = options.secureSession;
    this.sourceApi =
      options.sourceApi ??
      ({
        sources: async () => ({ ok: true as const, value: [] }),
        readSourceFile: async () => ({
          ok: false as const,
          error: "unavailable",
        }),
      } satisfies QaSourceApi);
    this.chats = new QaChatIndex(
      options.storage,
      qaStorageNamespace(options.config),
    );
    this.accounts = options.accounts;
    this.fileUpload = options.fileUpload ?? (() => undefined);
    this.hostSources = new QaHostSourceBridge(
      this.sourceApi,
      () => this.accounts?.token() ?? "",
    );
    this.hostApprovals = new QaHostApprovalBridge(options.approvalApi);
    this.hostQuestions = new QaHostQuestionBridge(options.questionApi);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.streamPublisher = new StreamPublisher(options.streamIntervalMs ?? 66);
    this.connectedOnce = this.connection.getSnapshot() !== undefined;
    this.unsubscribeConnection = this.connection.subscribe(() => {
      if (this.connection.getSnapshot() !== undefined)
        this.connectedOnce = true;
      this.publish();
    });
  }

  getSnapshot = (): QaSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  ensureSession(): Promise<void> {
    if (this.ensuring !== undefined) return this.ensuring;
    const operation = this.ensureSessionNow().finally(() => {
      if (this.ensuring === operation) this.ensuring = undefined;
    });
    this.ensuring = operation;
    return operation;
  }

  async send(
    text: string,
    attachments: readonly QaAttachmentDraft[] = [],
  ): Promise<boolean> {
    const prompt = text.trim();
    // Images ride the prompt inline; files must be staged first, because the
    // wire carries a receipt rather than bytes.
    const files = attachments.filter(
      (attachment): attachment is QaFileDraft => attachment.kind === "file",
    );
    if ((prompt === "" && attachments.length === 0) || !this.state.canSend) {
      return false;
    }
    if (prompt.startsWith("/")) {
      this.operationError = "Команды со слешем недоступны в режиме помощника.";
      this.publish();
      return false;
    }
    this.operationError = null;
    // Regeneration rides a hidden marker and must never leak it into the UI.
    const submission =
      prompt === QA_REGENERATE_MARKER
        ? undefined
        : this.beginSubmission(prompt, attachments);
    let accepted = false;
    let target: SessionFace | undefined;
    try {
      if (this.session === undefined) {
        // A draft chat materializes its session only now: nothing was created
        // when the user pressed "New chat", so the first prompt pays for it.
        if (!this.drafting || this.materializing !== undefined) return false;
        if (!(await this.materializeDraft()) || this.session === undefined) {
          return false;
        }
      }
      const step = await this.attestPolicy();
      if (step.kind === "stale") {
        // The user moved to another chat while the proof was pending; that
        // binding attests through its own flow and must not receive a prompt
        // meant for the old one.
        return false;
      }
      let attestedId = step.kind === "ok" ? step.sessionId : null;
      if (attestedId === null) {
        attestedId = await this.recoverForSend();
        if (attestedId === null) return false;
      }
      // Nothing can interleave between the last await and here, so matching the
      // attested id proves the prompt rides exactly the session it proved.
      target = this.session;
      if (
        this.disposed ||
        target === undefined ||
        String(target.sessionId) !== attestedId
      ) {
        return false;
      }
      if (submission !== undefined && this.pendingSubmission === submission) {
        // Recovery may have replaced the original chat with a fresh session;
        // reconcile against the actual prompt target, not the abandoned one.
        submission.baselineUserCount = this.state.messages.filter(
          (message) => message.role === "user",
        ).length;
      }
      let receipts = new Map<string, string>();
      if (files.length > 0) {
        const outcome = await stageQaFiles(this.fileUpload(), target, files);
        if (outcome.kind !== "ok") {
          if (this.session === target) {
            this.operationError =
              outcome.kind === "unavailable"
                ? "Вложения недоступны на этом сервере."
                : "Не удалось приложить файл.";
            this.publish();
          }
          return false;
        }
        receipts = outcome.receipts;
      }
      this.admissionPending = true;
      this.publish();
      const content = buildQaPromptContent(prompt, attachments, receipts);
      const result = await target.prompt(content, "queue");
      if (this.session !== target) return false;
      if (!result.ok) {
        this.admissionPending = false;
        this.operationError = "Не удалось отправить сообщение.";
        this.publish();
        return false;
      }
      accepted = true;
      if (submission !== undefined && this.pendingSubmission === submission) {
        submission.accepted = true;
      }
      this.publish();
      return true;
    } catch (error) {
      this.admissionPending = false;
      console.error("dsh-qa-surface: prompt failed", error);
      if (this.session === target) {
        this.operationError = "Не удалось отправить сообщение.";
        this.publish();
      }
      return false;
    } finally {
      if (
        !accepted &&
        submission !== undefined &&
        this.pendingSubmission === submission
      ) {
        this.pendingSubmission = undefined;
        this.publish();
      }
    }
  }

  /** Publish a browser-only copy before any network or Host admission awaits. */
  private beginSubmission(
    text: string,
    attachments: readonly QaAttachmentDraft[],
  ): PendingSubmission {
    const submission: PendingSubmission = {
      message: {
        id: `pending:${++this.pendingSequence}`,
        role: "user",
        text,
        status: "pending",
        timestamp: Date.now(),
        images: attachments.flatMap((attachment) =>
          attachment.kind === "image"
            ? [
                {
                  attachmentId: attachment.id,
                  mediaType: attachment.mediaType,
                  // The composer revokes its blob URL after send succeeds;
                  // the optimistic row may outlive that hand-off.
                  previewUrl: `data:${attachment.mediaType};base64,${attachment.data}`,
                },
              ]
            : [],
        ),
        files: attachments.flatMap((attachment) =>
          attachment.kind === "file"
            ? [
                {
                  attachmentId: attachment.id,
                  name: attachment.name,
                  bytes: attachment.bytes,
                },
              ]
            : [],
        ),
      },
      baselineUserCount: this.state.messages.filter(
        (message) => message.role === "user",
      ).length,
      accepted: false,
      sawRunning: false,
    };
    this.pendingSubmission = submission;
    this.publish();
    return submission;
  }

  /**
   * Ask for a fresh variant of the previous answer. The session has no
   * truncation seam, so this sends the hidden regeneration instruction as an
   * ordinary prompt: the model produces a follow-up turn, the projection
   * hides the marker message, and the consecutive turns read as variants of
   * the original question (switched in the surface).
   */
  async regenerate(): Promise<boolean> {
    return this.send(QA_REGENERATE_MARKER);
  }

  async stop(): Promise<void> {
    const target = this.session;
    if (target === undefined || !this.state.canStop) return;
    try {
      const result = await target.cancel();
      if (this.session !== target) return;
      if (!result.ok) this.operationError = "Не удалось остановить ответ.";
    } catch (error) {
      console.error("dsh-qa-surface: stop failed", error);
      if (this.session !== target) return;
      this.operationError = "Не удалось остановить ответ.";
    }
    this.publish();
  }

  /**
   * Enter the "new chat" draft: show an empty composer without creating any
   * session. Nothing appears in the chat list and no Host session is spent
   * until the first prompt is actually sent, which materializes the session
   * lazily ({@link materializeDraft}). Fixed-policy deployments cannot draft.
   */
  async startDraft(): Promise<void> {
    if (
      this.disposed ||
      this.config.session.policy === "fixed" ||
      (this.config.lockdown.enabled && !this.config.lockdown.allowSessionReset)
    )
      return;
    const previous = this.session;
    if (previous?.getSnapshot().running === true) {
      try {
        await previous.cancel();
      } catch (error) {
        console.error("dsh-qa-surface: stop before draft failed", error);
      }
    }
    this.drafting = true;
    this.pendingSubmission = undefined;
    this.unbind();
    this.operationError = null;
    this.admissionPending = false;
    this.policyReady = false;
    this.state = {
      ...QA_SESSION_IDLE_STATE,
      chatsRevision: this.chatsRevision,
    };
    this.publish();
  }

  /**
   * Turn the current draft into a real attested session. Runs inside the
   * send flow; concurrent sends share one materialization. A refusal here is
   * reported at once — a fresh session's first attestation is the
   * deployment's only chance to learn the reason.
   */
  private materializeDraft(): Promise<boolean> {
    if (this.materializing !== undefined) return this.materializing;
    const operation = ++this.generation;
    const attempt = (async () => {
      try {
        await this.waitForConnection();
        const id = await createQaSession({
          createSession: this.createSessionRemote,
          token: this.accounts?.token() ?? "",
        });
        if (this.disposed || operation !== this.generation) return false;
        await this.bind(id);
        if (this.disposed || operation !== this.generation) return false;
        this.drafting = false;
        if (this.config.session.policy === "browser-persistent") {
          this.chats.saveActive(id);
        }
        return true;
      } catch (error) {
        if (this.disposed || operation !== this.generation) return false;
        this.fail(
          this.operationError === CONFIGURATION_ERROR
            ? this.operationError
            : "Не удалось начать чат.",
          error,
        );
        return false;
      }
    })();
    this.materializing = attempt;
    this.publish();
    // `attempt` never rejects: every failure path is caught and reports false.
    void attempt.then(() => {
      if (this.materializing === attempt) this.materializing = undefined;
    });
    return attempt;
  }

  /**
   * Open one of this browser's indexed chats. The id must be present in the
   * host session list and pass policy attestation; an unknown id is forgotten
   * from the index. Fixed-policy deployments cannot switch.
   */
  async switchTo(sessionId: string): Promise<void> {
    if (this.disposed || this.config.session.policy === "fixed") return;
    if (
      this.session !== undefined &&
      String(this.session.sessionId) === sessionId
    )
      return;
    const operation = ++this.generation;
    this.drafting = false;
    this.pendingSubmission = undefined;
    this.viewingSubagent = null;
    this.unbind();
    this.operationError = null;
    this.admissionPending = false;
    this.policyReady = false;
    this.state = {
      ...QA_SESSION_IDLE_STATE,
      chatsRevision: this.chatsRevision,
      phase: "creating",
    };
    this.emit();
    try {
      await this.waitForConnection();
      const list = await waitFor(
        this.sessions.list,
        (snapshot) => snapshot.phase === "ready",
        this.timeoutMs,
      );
      if (this.disposed || operation !== this.generation) return;
      if (!Object.hasOwn(list.byId, sessionId as SessionId)) {
        this.forgetChat(sessionId);
        throw new Error("Этот чат больше недоступен.");
      }
      await this.bind(sessionId);
      if (this.disposed || operation !== this.generation) return;
      this.chats.saveActive(sessionId);
    } catch (error) {
      // A newer operation superseded this switch: its own outcome governs.
      if (this.disposed || operation !== this.generation) return;
      this.fail(
        this.operationError === CONFIGURATION_ERROR
          ? this.operationError
          : "Не удалось открыть этот чат.",
        error,
      );
    }
  }

  /**
   * Watch a subagent's transcript live. The binding is read-only by
   * construction: no attestation runs (attestation admits sending, and the
   * composer stays disabled here), the chat index is untouched, and
   * {@link closeSubagent} returns to the chat the panel was opened from.
   */
  async viewSubagent(id: string, title: string): Promise<void> {
    if (this.disposed) return;
    if (
      this.viewingSubagent !== null &&
      this.viewingSubagent.id === id &&
      this.session !== undefined
    ) {
      return;
    }
    const operation = ++this.generation;
    this.drafting = false;
    this.pendingSubmission = undefined;
    this.viewingSubagent = { id, title };
    this.unbind();
    this.operationError = null;
    this.admissionPending = false;
    this.policyReady = false;
    this.state = {
      ...QA_SESSION_IDLE_STATE,
      chatsRevision: this.chatsRevision,
      viewingSubagent: this.viewingSubagent,
      phase: "creating",
    };
    this.emit();
    try {
      await this.waitForConnection();
      await this.bind(id, { attest: false, track: false, report: false });
    } catch (error) {
      // A newer operation superseded this view request: leave its state alone.
      if (this.disposed || operation !== this.generation) return;
      this.viewingSubagent = null;
      this.fail("Не удалось открыть транскрипт субагента.", error);
    }
    if (this.disposed || operation !== this.generation) return;
  }

  /** Leave the subagent transcript and re-open the chat it was launched from. */
  async closeSubagent(): Promise<void> {
    const chat = this.chatSessionId;
    if (chat === null) return;
    await this.switchTo(chat);
  }

  /** This browser's chat ids: the owned list when accounts are on, else the
   * local index. Both intersect the host session list at projection time. */
  chatIds(): readonly string[] {
    const owned = this.accounts?.ownedIds() ?? [];
    if (owned.length === 0) return this.chats.chatIds();
    const local = this.chats.chatIds();
    return [...new Set([...owned, ...local])];
  }

  /** The bound session id, or null while no chat is bound. */
  activeSessionId(): string | null {
    return this.session === undefined ? null : String(this.session.sessionId);
  }

  /**
   * Resolve one durable image attachment of the bound session into a
   * browser-usable URL. Resolutions are cached per chat in the asset
   * repository (attachment ids repeat across chats) and revoked when the chat
   * is unbound; failures surface as broken views and retry on demand.
   */
  async readImage(attachmentId: string): Promise<string> {
    if (this.session === undefined) throw new Error("no bound session");
    const sessionId = String(this.session.sessionId);
    return this.assets.resolve(sessionId, attachmentId, (id) =>
      this.readAttachmentUrl(id),
    );
  }

  private async readAttachmentUrl(attachmentId: string): Promise<string> {
    const session = this.session;
    if (session === undefined) throw new Error("no bound session");
    const result = await session.readAttachment(
      attachmentId as Parameters<SessionFace["readAttachment"]>[0],
    );
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    const { attachment, data } = result.value;
    if (typeof URL.createObjectURL !== "function") {
      return `data:${attachment.mediaType};base64,${bytesToBase64(data)}`;
    }
    return URL.createObjectURL(
      new Blob([Uint8Array.from(data).buffer as ArrayBuffer], {
        type: attachment.mediaType,
      }),
    );
  }

  /**
   * Remove one chat from this browser's index. Deleting the chat that is
   * currently open also forgets the persisted id and starts a fresh attested
   * session (when the deployment allows session resets); the Host-side
   * session itself is not touched — no host deletion seam exists.
   */
  async deleteChat(id: string): Promise<void> {
    this.forgetChat(id);
    this.chatsRevision += 1;
    if (
      this.activeSessionId() === id &&
      this.config.session.policy !== "fixed"
    ) {
      // No replacement session is created: deleting the open chat falls back
      // to a draft, and the next prompt materializes a fresh one. The stale
      // persisted id is dropped so a reload cannot resurrect the deleted chat.
      this.chats.clearActive();
      await this.startDraft();
      return;
    }
    this.publish();
  }

  /** Drop one chat id from this browser's index. */
  forgetChat(sessionId: string): void {
    this.chats.forgetChat(sessionId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.streamPublisher.clear();
    this.unsubscribeConnection();
    this.unbind();
    this.assets.dispose();
    this.listeners.clear();
  }

  private async ensureSessionNow(): Promise<void> {
    const operation = ++this.generation;
    this.drafting = false;
    this.state = {
      ...QA_SESSION_IDLE_STATE,
      chatsRevision: this.chatsRevision,
      phase: "creating",
    };
    this.emit();
    try {
      await this.waitForConnection();
      const list = await waitFor(
        this.sessions.list,
        (snapshot) => snapshot.phase === "ready",
        this.timeoutMs,
      );
      let id: string | null = null;
      let restored = false;
      if (this.config.session.policy === "fixed") {
        id = this.config.session.fixedSessionId;
        if (id === null || !Object.hasOwn(list.byId, id)) {
          throw new Error("Configured fixed session is unavailable.");
        }
      } else if (this.config.session.policy === "browser-persistent") {
        const stored = this.chats.activeId();
        if (stored !== null && Object.hasOwn(list.byId, stored)) {
          id = stored;
          restored = true;
        } else if (stored !== null) {
          this.chats.clearActive();
        }
      }
      if (id === null) {
        id = await createQaSession({
          createSession: this.createSessionRemote,
          token: this.accounts?.token() ?? "",
        });
      }
      if (this.disposed || operation !== this.generation) return;
      // A restored id's first bind stays quiet: the recovery path below may
      // replace it. A freshly created session must report a refusal at once —
      // it is the deployment's only chance to learn the reason.
      try {
        await this.bind(id, { report: !restored });
      } catch (error) {
        // A stale restore must not start its recovery ladder against a newer
        // operation; rethrow for the generation-guarded outer catch.
        if (this.disposed || operation !== this.generation) throw error;
        if (
          !restored ||
          this.config.session.policy !== "browser-persistent" ||
          !(error instanceof QaPolicyAttestationError)
        ) {
          throw error;
        }

        // A stored id is only a hint. If Host refuses that session under the
        // current QA policy (for example after the configured preset changes),
        // forget it and bootstrap one fresh, policy-attested session instead.
        this.unbind();
        this.operationError = null;
        this.chats.clearActive();
        id = await createQaSession({
          createSession: this.createSessionRemote,
          token: this.accounts?.token() ?? "",
        });
        if (this.disposed || operation !== this.generation) return;
        await this.bind(id);
      }
      if (this.disposed || operation !== this.generation) return;
      if (this.config.session.policy === "browser-persistent") {
        this.chats.saveActive(id);
      }
    } catch (error) {
      // A newer operation superseded this bootstrap: its own outcome governs.
      if (this.disposed || operation !== this.generation) return;
      this.fail(
        this.operationError === CONFIGURATION_ERROR
          ? this.operationError
          : "Не удалось начать чат.",
        error,
      );
    }
  }

  /**
   * Recovery ladder after a refused send-time attestation. The prompt was
   * never admitted, so nothing here can duplicate it. Step 1 re-opens the
   * session: a Host that idled the agent out dismantles its tool view, and
   * re-opening re-materializes it. Step 2 — when that refused session is
   * still blank (it never received the prompt, so there is nothing to lose) —
   * starts a fresh attested session instead. A session with history is left
   * alone: recreating it would silently drop the conversation. Returns the
   * attested session id, or null when nothing was attested.
   */
  private async recoverForSend(): Promise<string | null> {
    const id =
      this.session === undefined ? null : String(this.session.sessionId);
    if (
      id === null ||
      this.disposed ||
      this.config.session.policy === "fixed"
    ) {
      return null;
    }
    const operation = ++this.generation;
    this.unbind();
    this.admissionPending = false;
    this.policyReady = false;
    this.state = { ...this.state, phase: "creating" };
    this.emit();
    try {
      await this.waitForConnection();
      try {
        await this.bind(id);
        if (this.disposed || operation !== this.generation) return null;
        if (this.policyReady) return id;
      } catch (error) {
        if (!(error instanceof QaPolicyAttestationError)) throw error;
        if (this.disposed || operation !== this.generation) return null;
      }
      if (this.session !== undefined && !this.session.getSnapshot().blank) {
        this.fail(CONFIGURATION_ERROR, new QaPolicyAttestationError());
        return null;
      }
      this.unbind();
      this.chats.clearActive();
      const created = await createQaSession({
        createSession: this.createSessionRemote,
        token: this.accounts?.token() ?? "",
      });
      if (this.disposed || operation !== this.generation) return null;
      await this.bind(created);
      if (this.disposed || operation !== this.generation) return null;
      this.chats.saveActive(created);
      return this.policyReady ? created : null;
    } catch (error) {
      if (this.disposed || operation !== this.generation) return null;
      this.fail(
        this.operationError === CONFIGURATION_ERROR
          ? this.operationError
          : "Не удалось открыть этот чат.",
        error,
      );
      return null;
    }
  }

  private async bind(
    id: string,
    options: { report?: boolean; attest?: boolean; track?: boolean } = {},
  ): Promise<void> {
    const { report = true, attest = true, track = true } = options;
    this.sessions.open(id as SessionId);
    let binding = this.sessions.binding(id as SessionId);
    if (binding === undefined) {
      await waitFor(
        this.sessions.list,
        (snapshot) => Object.hasOwn(snapshot.byId, id),
        this.timeoutMs,
      );
      binding = this.sessions.binding(id as SessionId);
    }
    if (binding === undefined)
      throw new Error("Session binding is unavailable.");
    this.unbind();
    this.session = binding.session;
    this.conversationBinding = this.conversation.binding(id as SessionId);
    this.policyReady = false;
    this.unsubscribeSession = binding.session.subscribe(() => {
      this.admissionPending = false;
      this.operationError = null;
      this.publishSessionUpdate();
    });
    // Subscribing the Chat target activates it, so the assembled transcript
    // (nodes, partials, running calls) materializes for the projection.
    this.unsubscribeChat = this.conversationBinding
      .target("chat")
      .subscribe(() => {
        this.publishSessionUpdate();
      });
    await waitFor(
      binding.session,
      (snapshot) =>
        snapshot.openState === "open" || snapshot.openState === "error",
      this.timeoutMs,
    );
    if (binding.session.getSnapshot().openState !== "open") {
      throw new Error("Session binding could not be opened.");
    }
    if (attest) {
      const step = await this.attestPolicy(report);
      if (step.kind !== "ok") throw new QaPolicyAttestationError();
    }
    if (track) {
      this.chatSessionId = String(this.session.sessionId);
      this.viewingSubagent = null;
      this.chats.addChat(String(this.session.sessionId));
      this.accounts?.onSessionCreated(String(this.session.sessionId));
    }
    this.publish();
  }

  private unbind(): void {
    this.streamPublisher.clear();
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    this.unsubscribeChat?.();
    this.unsubscribeChat = undefined;
    this.conversationBinding = undefined;
    if (this.session !== undefined) {
      // Leaving the chat retires its attachment URLs; a later re-bind
      // re-resolves them from the durable store.
      this.assets.release(String(this.session.sessionId));
    }
    this.session = undefined;
    this.hostSources.reset();
    this.hostApprovals.reset();
    this.hostQuestions.reset();
    this.stopPendingPolling();
    this.admissionPending = false;
    this.policyReady = false;
  }

  private waitForConnection(): Promise<unknown> {
    return waitFor(
      this.connection,
      (description) => description !== undefined,
      this.timeoutMs,
    );
  }

  /** Project one session notification; the running-turn spacing policy
   * (first frame at once, further frames absorbed) lives in the publisher. */
  private publishSessionUpdate(): void {
    this.streamPublisher.publish(
      this.session?.getSnapshot().running === true,
      () => this.publish(),
    );
  }

  private publish(): void {
    if (this.disposed) return;
    const connected = this.connection.getSnapshot() !== undefined;
    if (this.drafting && this.session === undefined) {
      // Draft state: an empty writable composer without a bound session. The
      // session list is untouched — nothing exists until the first send.
      const materializing =
        this.materializing !== undefined ||
        this.pendingSubmission !== undefined;
      this.state = {
        ...QA_SESSION_IDLE_STATE,
        phase: materializing
          ? "creating"
          : !connected && this.connectedOnce
            ? "reconnecting"
            : "idle",
        error: this.operationError,
        canSend: connected && !materializing,
        pendingMessage: this.pendingSubmission?.message ?? null,
        chatsRevision: this.chatsRevision,
      };
      this.emit();
      return;
    }
    if (this.session === undefined) {
      this.state = {
        ...this.state,
        phase:
          !connected && this.connectedOnce ? "reconnecting" : this.state.phase,
        error: this.operationError ?? this.state.error,
      };
      this.emit();
      return;
    }
    const snapshot = this.session.getSnapshot();
    const sessionId = String(this.session.sessionId);
    const conversationSnapshot =
      this.conversationBinding?.snapshot.getSnapshot();
    const projectedSourceBundles = projectTurnSources(
      conversationSnapshot,
      sessionId,
      this.config.session.cwd ?? undefined,
    );
    const sourceBundles = this.hostSources.merge(projectedSourceBundles);
    if (!snapshot.running) {
      void this.hostSources.refresh(sessionId, () => this.publish());
    }
    this.syncPendingPolling(snapshot.running === true);
    const projectionInput = {
      connected,
      sessionId,
      sessionSnapshot: snapshot,
      conversationSnapshot,
      sourceBundles,
      approvals: this.hostApprovals.list(),
      questions: this.hostQuestions.list(),
      // Ownership is chat-level: every user message of a foreign chat
      // carries its owner's name when an admin reads it.
      author: this.accounts?.messageAuthorOf(sessionId),
      operationError: this.operationError,
      policyReady: this.policyReady,
      admissionPending:
        this.admissionPending || this.pendingSubmission !== undefined,
      chatsRevision: this.chatsRevision,
      viewingSubagent: this.viewingSubagent,
      config: this.config,
    } as const;
    let projected = projectBoundSessionState(projectionInput);
    const pending = this.pendingSubmission;
    if (pending !== undefined) {
      if (snapshot.running) pending.sawRunning = true;
      const committedUserCount = projected.messages.filter(
        (message) => message.role === "user",
      ).length;
      if (
        committedUserCount > pending.baselineUserCount ||
        (pending.accepted && pending.sawRunning && !snapshot.running)
      ) {
        this.pendingSubmission = undefined;
        // The first projection was intentionally busy while the optimistic
        // row existed. Recompute once so the same notification can restore
        // ready/sendable state when that row is retired.
        projected = projectBoundSessionState({
          ...projectionInput,
          admissionPending: this.admissionPending,
        });
      }
    }
    this.state = {
      ...projected,
      pendingMessage: this.pendingSubmission?.message ?? null,
    };
    this.emit();
  }

  private fail(message: string, error: unknown): void {
    // Policy attestation refusals already logged their precise reason; a
    // second stack trace for the wrapper error is only console noise.
    if (!(error instanceof QaPolicyAttestationError)) {
      console.error("dsh-qa-surface: session operation failed", error);
    }
    if (this.disposed) return;
    this.operationError = message;
    this.state = {
      ...QA_SESSION_IDLE_STATE,
      phase: "error",
      error: message,
      chatsRevision: this.chatsRevision,
    };
    this.emit();
  }

  /**
   * Attest the currently bound session. `ok` carries the session id the proof
   * was issued for; `stale` means the binding changed while the request was
   * in flight, so nothing was written — the newer binding manages its own
   * attestation; `refused` is a genuine admission refusal of this binding.
   */
  private async attestPolicy(
    reportFailure = true,
  ): Promise<
    { kind: "ok"; sessionId: string } | { kind: "refused" } | { kind: "stale" }
  > {
    const session = this.session;
    if (session === undefined) return { kind: "refused" };
    const sessionId = String(session.sessionId);
    if (!this.config.lockdown.enabled) {
      this.policyReady = true;
      return { kind: "ok", sessionId };
    }
    this.policyReady = false;
    this.publish();
    const outcome = await attestQaPolicy({
      secureSession: this.secureSessionRemote,
      token: this.accounts?.token() ?? "",
      sessionId,
      lockdown: this.config.lockdown,
      report: reportFailure,
    });
    if (this.session !== session) return { kind: "stale" };
    if (outcome.ok) {
      this.policyReady = true;
      this.operationError = null;
      this.publish();
      return { kind: "ok", sessionId };
    }
    if (outcome.authRequired) {
      // The identity expired or was rotated: back to the gate instead of
      // the generic configuration error.
      this.accounts?.onAuthRequired();
      return { kind: "refused" };
    }
    this.policyReady = false;
    this.operationError = CONFIGURATION_ERROR;
    this.publish();
    return { kind: "refused" };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Answer a request the Host parked for this chat. The Host re-checks the
   * request against the chat, so an answer that lost its race is a no-op; the
   * refresh that follows is what the surface renders.
   */
  async answerApproval(
    requestId: string,
    decision: QaApprovalDecision,
  ): Promise<void> {
    if (this.session === undefined) return;
    await this.hostApprovals.answer(
      String(this.session.sessionId),
      this.hostToken(),
      requestId,
      decision,
    );
    this.publish();
  }

  /** Send the operator's answers to one parked question request. */
  async answerQuestion(
    requestId: string,
    answers: readonly QaQuestionAnswerItem[],
  ): Promise<void> {
    if (this.session === undefined) return;
    await this.hostQuestions.answer(
      String(this.session.sessionId),
      this.hostToken(),
      requestId,
      answers,
    );
    this.publish();
  }

  /** Close a parked question request without answering it. */
  async cancelQuestion(requestId: string): Promise<void> {
    if (this.session === undefined) return;
    await this.hostQuestions.cancel(
      String(this.session.sessionId),
      this.hostToken(),
      requestId,
    );
    this.publish();
  }

  /**
   * Poll the Host for parked requests while a turn runs. A request only exists
   * inside an open turn, and it is Host state: polling is how the page learns
   * about it, and how it reappears after a reload. One timer serves both seams,
   * and each is polled only where the deployment answers it.
   */
  private syncPendingPolling(running: boolean): void {
    const approvals = this.hostApprovals.available
      ? this.config.interaction.approvals === "interactive"
      : false;
    const questions = this.hostQuestions.available
      ? this.config.interaction.questions === "interactive"
      : false;
    const wanted =
      running &&
      (approvals || questions) &&
      // A subagent watched from the panel is a read-only view of a session the
      // chat owns: its own requests belong to the chat, not to this binding.
      this.viewingSubagent === null &&
      this.session !== undefined;
    if (!wanted) {
      this.stopPendingPolling();
      return;
    }
    if (this.pendingTimer !== undefined || this.session === undefined) return;
    const sessionId = String(this.session.sessionId);
    const token = this.hostToken();
    const tick = () => {
      if (approvals) {
        void this.hostApprovals.refresh(sessionId, token, () => this.publish());
      }
      if (questions) {
        void this.hostQuestions.refresh(sessionId, token, () => this.publish());
      }
    };
    this.pendingTimer = setInterval(tick, PENDING_POLL_MS);
    tick();
  }

  private stopPendingPolling(): void {
    if (this.pendingTimer === undefined) return;
    clearInterval(this.pendingTimer);
    this.pendingTimer = undefined;
  }

  private hostToken(): string {
    return this.accounts?.token() ?? "";
  }
}
