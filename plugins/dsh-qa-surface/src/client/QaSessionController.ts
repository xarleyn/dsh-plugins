import type {
  ConnectionGenerationState,
  SessionId,
} from "@deepseek-ai/dsh-client-connection/client";
import type { SessionFace } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ConversationBinding } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { WorkspaceId } from "@deepseek-ai/dsh-workspace/types";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
import type {
  QaImageDraft,
  QaSessionState,
  QaSubagentView,
  QaTurnSources,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import {
  QaPolicyAttestationError,
  attestationHint,
  attestationReasonOf,
  proofMatchesConfig,
} from "./attestation.js";
import { QaChatIndex } from "./chat-index.js";
import type {
  QaConversation,
  QaPromptContent,
  QaSecureSession,
  QaSessions,
  QaSessionsApi,
  QaSourceApi,
  StorageLike,
} from "./types.js";
import { QA_SESSION_IDLE_STATE } from "./types.js";
import { waitFor } from "./wait-for.js";
import {
  projectTurnSources,
  projectTranscript,
  QA_REGENERATE_MARKER,
} from "./QaTranscriptAdapter.js";

export interface QaSessionControllerOptions {
  readonly sessions: QaSessions;
  readonly api: QaSessionsApi;
  /** Conversation assembly feeding the transcript projection. */
  readonly conversation: QaConversation;
  readonly connection: ConnectionGenerationState;
  readonly config: ResolvedQaSurfaceConfig;
  readonly secureSession: QaSecureSession;
  readonly sourceApi?: QaSourceApi;
  readonly storage?: StorageLike;
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
 * The only module that couples QA behavior to DSH Session/client APIs. It owns
 * the chat lifecycle state machine; the observable wait, browser-local chat
 * bookkeeping and policy-attestation details live in their own modules.
 */
export class QaSessionController {
  private readonly listeners = new Set<() => void>();
  private readonly sessions: QaSessions;
  private readonly api: QaSessionsApi;
  private readonly conversation: QaConversation;
  private readonly connection: ConnectionGenerationState;
  private readonly config: ResolvedQaSurfaceConfig;
  private readonly secureSessionRemote: QaSecureSession;
  private readonly sourceApi: QaSourceApi;
  private readonly chats: QaChatIndex;
  private readonly timeoutMs: number;
  private readonly streamIntervalMs: number;
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
  private policyReady = false;
  private drafting = false;
  private streamFlushTimer: ReturnType<typeof setTimeout> | undefined;
  /** The chat session to return to when a subagent view closes. */
  private chatSessionId: string | null = null;
  private viewingSubagent: QaSubagentView | null = null;
  private connectedOnce: boolean;
  private disposed = false;
  private generation = 0;
  private chatsRevision = 0;
  private hostSourceBundles: readonly QaTurnSources[] = [];
  private hostSourcesSignature = "";
  private refreshingHostSources = false;

  constructor(options: QaSessionControllerOptions) {
    this.sessions = options.sessions;
    this.api = options.api;
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
      `${options.config.session.storageKey}:v1:${options.config.route.path}`,
    );
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.streamIntervalMs = options.streamIntervalMs ?? 66;
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
    images: readonly QaImageDraft[] = [],
  ): Promise<boolean> {
    const prompt = text.trim();
    if ((prompt === "" && images.length === 0) || !this.state.canSend) {
      return false;
    }
    if (prompt.startsWith("/")) {
      this.operationError = "Команды со слешем недоступны в режиме помощника.";
      this.publish();
      return false;
    }
    if (this.session === undefined) {
      // A draft chat materializes its session only now: nothing was created
      // when the user pressed "New chat", so the first prompt pays for it.
      if (!this.drafting || this.materializing !== undefined) return false;
      if (!(await this.materializeDraft()) || this.session === undefined) {
        return false;
      }
    }
    this.operationError = null;
    let attested = await this.attestPolicy();
    if (!attested) {
      attested = await this.recoverForSend();
      if (!attested) return false;
    }
    this.admissionPending = true;
    this.publish();
    try {
      const content: QaPromptContent = [
        ...(prompt === "" ? [] : [{ type: "text" as const, text: prompt }]),
        ...images.map((image) => ({
          type: "image" as const,
          mediaType: image.mediaType,
          data: image.data,
          name: image.name,
        })),
      ];
      const result = await this.session.prompt(content, "queue");
      if (!result.ok) {
        this.admissionPending = false;
        this.operationError = "Не удалось отправить сообщение.";
        this.publish();
        return false;
      }
      this.publish();
      return true;
    } catch (error) {
      this.admissionPending = false;
      console.error("dsh-qa-surface: prompt failed", error);
      this.operationError = "Не удалось отправить сообщение.";
      this.publish();
      return false;
    }
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
    if (this.session === undefined || !this.state.canStop) return;
    try {
      const result = await this.session.cancel();
      if (!result.ok) this.operationError = "Не удалось остановить ответ.";
    } catch (error) {
      console.error("dsh-qa-surface: stop failed", error);
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
        const id = await this.createSession();
        if (this.disposed || operation !== this.generation) return false;
        await this.bind(id);
        if (this.disposed || operation !== this.generation) return false;
        this.drafting = false;
        if (this.config.session.policy === "browser-persistent") {
          this.chats.saveActive(id);
        }
        return true;
      } catch (error) {
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

  /** This browser's indexed chat ids, most recently used first. */
  chatIds(): readonly string[] {
    return this.chats.chatIds();
  }

  /** The bound session id, or null while no chat is bound. */
  activeSessionId(): string | null {
    return this.session === undefined ? null : String(this.session.sessionId);
  }

  /**
   * Resolve one durable image attachment of the bound session into a
   * browser-usable URL. The caller caches; failures surface as broken views.
   */
  async readImage(attachmentId: string): Promise<string> {
    if (this.session === undefined) throw new Error("no bound session");
    const result = await this.session.readAttachment(
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
    this.clearStreamFlush();
    this.unsubscribeConnection();
    this.unbind();
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
        id = await this.createSession();
      }
      if (this.disposed || operation !== this.generation) return;
      // A restored id's first bind stays quiet: the recovery path below may
      // replace it. A freshly created session must report a refusal at once —
      // it is the deployment's only chance to learn the reason.
      try {
        await this.bind(id, { report: !restored });
      } catch (error) {
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
        id = await this.createSession();
        if (this.disposed || operation !== this.generation) return;
        await this.bind(id);
      }
      if (this.disposed || operation !== this.generation) return;
      if (this.config.session.policy === "browser-persistent") {
        this.chats.saveActive(id);
      }
    } catch (error) {
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
   * alone: recreating it would silently drop the conversation.
   */
  private async recoverForSend(): Promise<boolean> {
    const id =
      this.session === undefined ? null : String(this.session.sessionId);
    if (
      id === null ||
      this.disposed ||
      this.config.session.policy === "fixed"
    ) {
      return false;
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
        if (this.disposed || operation !== this.generation) return false;
        if (this.policyReady) return true;
      } catch (error) {
        if (!(error instanceof QaPolicyAttestationError)) throw error;
        if (this.disposed || operation !== this.generation) return false;
      }
      if (this.session !== undefined && !this.session.getSnapshot().blank) {
        this.fail(CONFIGURATION_ERROR, new QaPolicyAttestationError());
        return false;
      }
      this.unbind();
      this.chats.clearActive();
      const created = await this.createSession();
      if (this.disposed || operation !== this.generation) return false;
      await this.bind(created);
      if (this.disposed || operation !== this.generation) return false;
      this.chats.saveActive(created);
      return this.policyReady;
    } catch (error) {
      this.fail(
        this.operationError === CONFIGURATION_ERROR
          ? this.operationError
          : "Не удалось открыть этот чат.",
        error,
      );
      return false;
    }
  }

  private async createSession(): Promise<string> {
    const created = await this.sessions.create({
      ...(this.config.session.workspaceId !== null
        ? { workspaceId: this.config.session.workspaceId as WorkspaceId }
        : this.config.session.cwd !== null
          ? { cwd: this.config.session.cwd }
          : {}),
    });
    const id = String(created);
    if (this.config.session.agentPreset !== null) {
      // The creation wire takes no preset, so the pin lands right after:
      // agentPresets/select recomposes the still-blank session's agent and
      // durably logs `agent-preset/selected`, which the client projection
      // replays. The session is addressed only here — no prompt can run
      // before this returns, because sending requires a passed attestation
      // that verifies the composed preset.
      const selectedPreset = await this.api.selectAgentPreset(
        id as SessionId,
        this.config.session.agentPreset,
      );
      if (!selectedPreset.ok) {
        throw new Error(selectedPreset.error.code);
      }
    }
    if (
      this.config.session.provider !== null &&
      this.config.session.model !== null
    ) {
      const selected = await this.api.selectModel({
        sessionId: id as SessionId,
        provider: this.config.session.provider,
        model: this.config.session.model,
        ...(this.config.session.reasoningEffort === null
          ? {}
          : { reasoningEffort: this.config.session.reasoningEffort }),
      });
      if (!selected.ok) throw new Error(selected.error.code);
    }
    return id;
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
    if (attest && !(await this.attestPolicy(report))) {
      throw new QaPolicyAttestationError();
    }
    if (track) {
      this.chatSessionId = String(this.session.sessionId);
      this.viewingSubagent = null;
      this.chats.addChat(String(this.session.sessionId));
    }
    this.publish();
  }

  private unbind(): void {
    this.clearStreamFlush();
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    this.unsubscribeChat?.();
    this.unsubscribeChat = undefined;
    this.conversationBinding = undefined;
    this.session = undefined;
    this.hostSourceBundles = [];
    this.hostSourcesSignature = "";
    this.refreshingHostSources = false;
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

  /**
   * Project one session notification. A running turn's frames arrive at
   * animation-frame cadence, so re-projections are spaced at least
   * {@link streamIntervalMs} apart: the first frame of a window projects at
   * once and further frames are absorbed (the memoized render path replays
   * nothing, so absorbing a frame only defers it). Everything outside a
   * running turn - phase flips, errors, turn completion - projects
   * immediately.
   */
  private publishSessionUpdate(): void {
    if (
      this.streamIntervalMs <= 0 ||
      this.session?.getSnapshot().running !== true
    ) {
      this.clearStreamFlush();
      this.publish();
      return;
    }
    if (this.streamFlushTimer !== undefined) return;
    this.publish();
    this.streamFlushTimer = setTimeout(() => {
      this.streamFlushTimer = undefined;
    }, this.streamIntervalMs);
  }

  private clearStreamFlush(): void {
    if (this.streamFlushTimer === undefined) return;
    clearTimeout(this.streamFlushTimer);
    this.streamFlushTimer = undefined;
  }

  private publish(): void {
    if (this.disposed) return;
    const connected = this.connection.getSnapshot() !== undefined;
    if (this.drafting && this.session === undefined) {
      // Draft state: an empty writable composer without a bound session. The
      // session list is untouched — nothing exists until the first send.
      const materializing = this.materializing !== undefined;
      this.state = {
        ...QA_SESSION_IDLE_STATE,
        phase: materializing
          ? "creating"
          : !connected && this.connectedOnce
            ? "reconnecting"
            : "idle",
        error: this.operationError,
        canSend: connected && !materializing,
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
    // A pending approval interaction is invisible to this snapshot in 0.1.5;
    // the QA lockdown pins approval=never and strips escalation-requiring
    // tools, so no interaction the surface cannot answer should ever arise.
    const error =
      this.operationError ??
      (snapshot.removed || snapshot.openState === "error"
        ? "Этот чат больше недоступен."
        : null);
    const phase = !connected
      ? "reconnecting"
      : snapshot.removed || snapshot.openState === "error"
        ? "error"
        : snapshot.openState !== "open"
          ? "creating"
          : snapshot.running || this.admissionPending
            ? "running"
            : "ready";
    const conversationSnapshot =
      this.conversationBinding?.snapshot.getSnapshot();
    const projectedSourceBundles = projectTurnSources(
      conversationSnapshot,
      String(this.session.sessionId),
      this.config.session.cwd ?? undefined,
    );
    const sourceBundles = this.mergeSourceBundles(projectedSourceBundles);
    if (!snapshot.running) void this.refreshHostSourceBundles();
    const sourcesByTurn = new Map(
      sourceBundles.map((bundle) => [bundle.turn, bundle] as const),
    );
    const messages = projectTranscript(conversationSnapshot, {
      running: snapshot.running,
      showToolActivity: this.config.ui.showToolActivity,
      showReasoning: this.config.ui.showReasoning,
    }).map((message) => {
      if (message.role !== "assistant" || message.turn === undefined)
        return message;
      const bundle = sourcesByTurn.get(message.turn);
      const sources =
        bundle === undefined
          ? undefined
          : [
              ...bundle.sources,
              ...(this.config.sources.display.showDiscovered
                ? (bundle.discovered ?? [])
                : []),
            ];
      return sources === undefined || sources.length === 0
        ? message
        : {
            ...message,
            sources,
            sourcesComplete: bundle?.complete ?? true,
            ...(bundle?.incompleteOrigins === undefined
              ? {}
              : { incompleteSourceOrigins: bundle.incompleteOrigins }),
          };
    });
    this.state = {
      phase,
      sessionId: String(this.session.sessionId),
      messages,
      error,
      canSend: connected && phase === "ready" && this.policyReady,
      canStop: connected && snapshot.running && this.config.ui.showStop,
      chatsRevision: this.chatsRevision,
      sources:
        sourceBundles.at(-1) === undefined
          ? []
          : [
              ...(sourceBundles.at(-1)?.sources ?? []),
              ...(this.config.sources.display.showDiscovered
                ? (sourceBundles.at(-1)?.discovered ?? [])
                : []),
            ],
      sourcesComplete: sourceBundles.at(-1)?.complete ?? true,
      incompleteSourceOrigins: sourceBundles.at(-1)?.incompleteOrigins,
      viewingSubagent: this.viewingSubagent,
    };
    this.emit();
  }

  private mergeSourceBundles(
    projected: readonly QaTurnSources[],
  ): readonly QaTurnSources[] {
    const merged = new Map<number, QaTurnSources>();
    for (const bundle of projected) merged.set(bundle.turn, bundle);
    for (const bundle of this.hostSourceBundles)
      merged.set(bundle.turn, bundle);
    return [...merged.values()].sort((left, right) => left.turn - right.turn);
  }

  private async refreshHostSourceBundles(): Promise<void> {
    if (this.refreshingHostSources || this.session === undefined) return;
    const sessionId = String(this.session.sessionId);
    this.refreshingHostSources = true;
    try {
      const result = await this.sourceApi.sources(sessionId);
      if (
        !result.ok ||
        this.session === undefined ||
        String(this.session.sessionId) !== sessionId
      )
        return;
      const signature = JSON.stringify(result.value);
      if (signature === this.hostSourcesSignature) return;
      this.hostSourcesSignature = signature;
      this.hostSourceBundles = result.value;
      this.publish();
    } finally {
      this.refreshingHostSources = false;
    }
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

  private async attestPolicy(reportFailure = true): Promise<boolean> {
    if (this.session === undefined) return false;
    if (!this.config.lockdown.enabled) {
      this.policyReady = true;
      return true;
    }
    this.policyReady = false;
    this.publish();
    // One precise console diagnostic per refusal: the coarse Host reason code
    // plus an operator hint. The QA-facing message stays generic by design.
    const reject = (reason: string | null): false => {
      if (reportFailure) {
        console.error(
          `dsh-qa-surface: policy attestation failed (reason: ${reason ?? "unknown"}). ${attestationHint(reason)}`,
        );
      }
      this.policyReady = false;
      this.operationError = CONFIGURATION_ERROR;
      this.publish();
      return false;
    };
    try {
      const result = await this.secureSessionRemote(
        String(this.session.sessionId),
      );
      if (!result.ok) {
        return reject(
          attestationReasonOf(result.error as { readonly message?: string }),
        );
      }
      if (
        !proofMatchesConfig(
          result.value,
          this.config.lockdown,
          String(this.session.sessionId),
        )
      ) {
        return reject("proof-mismatch");
      }
      this.policyReady = true;
      this.operationError = null;
      this.publish();
      return true;
    } catch (error) {
      if (reportFailure) {
        console.error(
          "dsh-qa-surface: policy attestation request failed",
          error,
        );
      }
      this.policyReady = false;
      this.operationError = CONFIGURATION_ERROR;
      this.publish();
      return false;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
