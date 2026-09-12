import type {
  ConnectionGenerationState,
  SessionId,
} from "@deepseek-ai/dsh-client-connection/client";
import type { SessionFace } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ConversationBinding } from "@deepseek-ai/dsh-client-ui-conversation/client";

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
  ResolvedQaSurfaceConfig,
} from "../types.js";
import { QaPolicyAttestationError } from "./attestation.js";
import { QaChatIndex } from "./chat-index.js";
import { SessionAssetRepository } from "./session-assets.js";
import { createQaSession } from "./create-session.js";
import { attestQaPolicy } from "./session-admission.js";
import { QaHostSourceBridge } from "./session-sources.js";
import type {
  QaConversation,
  QaCreateSession,
  QaPromptContent,
  QaSecureSession,
  QaSessions,
  QaSessionsApi,
  QaSourceApi,
  StorageLike,
} from "./types.js";
import { QA_SESSION_IDLE_STATE } from "./types.js";
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
  readonly storage?: StorageLike;
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
  /** Per-chat attachment URL cache; blob URLs die with the chat binding. */
  private readonly assets = new SessionAssetRepository();
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
  /** Host-side provenance of the bound chat, merged into the projection. */
  private readonly hostSources: QaHostSourceBridge;

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
      `${options.config.session.storageKey}:v1:${options.config.route.path}`,
    );
    this.accounts = options.accounts;
    this.hostSources = new QaHostSourceBridge(
      this.sourceApi,
      () => this.accounts?.token() ?? "",
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
    const target = this.session;
    if (
      this.disposed ||
      target === undefined ||
      String(target.sessionId) !== attestedId
    ) {
      return false;
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
      const result = await target.prompt(content, "queue");
      if (this.session !== target) return false;
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
      if (this.session === target) {
        this.operationError = "Не удалось отправить сообщение.";
        this.publish();
      }
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
    this.clearStreamFlush();
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
    this.clearStreamFlush();
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
    this.state = projectBoundSessionState({
      connected,
      sessionId,
      sessionSnapshot: snapshot,
      conversationSnapshot,
      sourceBundles,
      // Ownership is chat-level: every user message of a foreign chat
      // carries its owner's name when an admin reads it.
      author: this.accounts?.messageAuthorOf(sessionId),
      operationError: this.operationError,
      policyReady: this.policyReady,
      admissionPending: this.admissionPending,
      chatsRevision: this.chatsRevision,
      viewingSubagent: this.viewingSubagent,
      config: this.config,
    });
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
}
