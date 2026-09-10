import type {
  HostDescriptionSource,
  IApiClient,
  SessionId,
  WorkspaceId,
} from "@deepseek-ai/dsh-client-connection/client";
import type {
  ISessions,
  SessionFace,
  SessionListState,
  SessionRuntime,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { QaSessionState, ResolvedQaSurfaceConfig } from "../types.js";
import type { QaLockdownProof } from "../types.js";
import { projectTranscript } from "./QaTranscriptAdapter.js";

type QaSessions = ISessions & Pick<SessionRuntime, "create">;
type QaSessionsApi = Pick<IApiClient["sessions"], "selectModel"> & {
  readonly selectAgentPreset: IApiClient["agentPresets"]["select"];
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface QaSessionControllerOptions {
  readonly sessions: QaSessions;
  readonly api: QaSessionsApi;
  readonly connection: HostDescriptionSource;
  readonly config: ResolvedQaSurfaceConfig;
  readonly secureSession: (sessionId: string) => Promise<
    | { readonly ok: true; readonly value: QaLockdownProof }
    | {
        readonly ok: false;
        readonly error: unknown;
      }
  >;
  readonly storage?: StorageLike;
  readonly timeoutMs?: number;
}

const EMPTY_STATE: QaSessionState = Object.freeze({
  phase: "idle",
  sessionId: null,
  messages: Object.freeze([]),
  error: null,
  canSend: false,
  canStop: false,
  chatsRevision: 0,
});

/** Cap on the per-browser chat index so localStorage cannot grow unbounded. */
const MAX_INDEXED_CHATS = 50;
const CONFIGURATION_ERROR = "Настройки помощника недоступны.";

/** The `(reason: <code>)` marker the Host folds into attestation wire failures. */
const ATTESTATION_REASON_MARKER = /\(reason: ([a-z-]+)\)/u;

/**
 * Extract the coarse attestation reason code from a Host wire failure, if the
 * failure carries the marker. The specific mismatch facts stay in the Host
 * logs; this code only tells the operator which class of check refused.
 */
export function attestationReasonOf(
  failure:
    | {
        readonly message?: string;
      }
    | undefined
    | null,
): string | null {
  const match = ATTESTATION_REASON_MARKER.exec(failure?.message ?? "");
  const reason = match?.[1];
  return reason === undefined ? null : reason;
}

function attestationHint(reason: string | null): string {
  if (reason === "unknown-tools") {
    return "A lockdown.toolPolicy name is not mounted in this session's tool catalog — check the deployment agent preset and the tool's server availability.";
  }
  if (reason === "composition-mismatch") {
    return "The session's agent preset, workspace or model no longer matches the deployment QA config.";
  }
  if (reason === "permission-preset") {
    return "The configured permission preset did not resolve to the pinned sandbox/approval policy.";
  }
  if (reason === "adoption-refused") {
    return "This browser tried to adopt a session created outside the current QA policy.";
  }
  return "The specific mismatch facts are written to the Host logs.";
}

class QaPolicyAttestationError extends Error {
  constructor() {
    super("QA session policy could not be attested.");
    this.name = "QaPolicyAttestationError";
  }
}

function waitFor<T>(
  source: {
    getSnapshot(): T;
    subscribe(listener: () => void): () => void;
  },
  predicate: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const current = source.getSnapshot();
  if (predicate(current)) return Promise.resolve(current);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout: { id?: ReturnType<typeof setTimeout> } = {};
    let unsubscribe: () => void = () => undefined;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      if (timeout.id !== undefined) clearTimeout(timeout.id);
      unsubscribe();
      resolve(value);
    };
    unsubscribe = source.subscribe(() => {
      const next = source.getSnapshot();
      if (predicate(next)) finish(next);
    });
    // Tolerate observable implementations that notify synchronously while a
    // subscriber is being installed, and close that subscription afterward.
    if (settled) {
      unsubscribe();
      return;
    }
    const afterSubscribe = source.getSnapshot();
    if (predicate(afterSubscribe)) {
      finish(afterSubscribe);
      return;
    }
    timeout.id = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error("Timed out waiting for the DSH runtime."));
    }, timeoutMs);
  });
}

/** The only module that couples QA behavior to DSH Session/client APIs. */
export class QaSessionController {
  private readonly listeners = new Set<() => void>();
  private readonly sessions: QaSessions;
  private readonly api: QaSessionsApi;
  private readonly connection: HostDescriptionSource;
  private readonly config: ResolvedQaSurfaceConfig;
  private readonly secureSessionRemote: QaSessionControllerOptions["secureSession"];
  private readonly storage: StorageLike | undefined;
  private readonly timeoutMs: number;
  private state: QaSessionState = EMPTY_STATE;
  private session: SessionFace | undefined;
  private unsubscribeSession: (() => void) | undefined;
  private readonly unsubscribeConnection: () => void;
  private ensuring: Promise<void> | undefined;
  private operationError: string | null = null;
  private admissionPending = false;
  private policyReady = false;
  private connectedOnce: boolean;
  private disposed = false;
  private generation = 0;
  private chatsRevision = 0;

  constructor(options: QaSessionControllerOptions) {
    this.sessions = options.sessions;
    this.api = options.api;
    this.connection = options.connection;
    this.config = options.config;
    this.secureSessionRemote = options.secureSession;
    this.storage = options.storage;
    this.timeoutMs = options.timeoutMs ?? 15_000;
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

  async send(text: string): Promise<boolean> {
    const prompt = text.trim();
    if (prompt === "" || this.session === undefined || !this.state.canSend) {
      return false;
    }
    if (prompt.startsWith("/")) {
      this.operationError = "Команды со слешем недоступны в режиме помощника.";
      this.publish();
      return false;
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
      const result = await this.session.prompt(
        [{ type: "text", text: prompt }],
        "queue",
      );
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

  async reset(): Promise<void> {
    if (
      this.config.session.policy === "fixed" ||
      (this.config.lockdown.enabled && !this.config.lockdown.allowSessionReset)
    )
      return;
    const previous = this.session;
    if (previous?.getSnapshot().running === true) {
      try {
        await previous.cancel();
      } catch (error) {
        console.error("dsh-qa-surface: stop before reset failed", error);
      }
    }
    const operation = ++this.generation;
    this.unbind();
    this.operationError = null;
    this.admissionPending = false;
    this.policyReady = false;
    this.state = {
      ...EMPTY_STATE,
      chatsRevision: this.chatsRevision,
      phase: "creating",
    };
    this.emit();
    try {
      await this.waitForConnection();
      const id = await this.createSession();
      if (this.disposed || operation !== this.generation) return;
      await this.bind(id);
      if (this.disposed || operation !== this.generation) return;
      this.persist(id);
    } catch (error) {
      this.fail(
        this.operationError === CONFIGURATION_ERROR
          ? this.operationError
          : "Не удалось начать новый чат.",
        error,
      );
    }
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
    this.unbind();
    this.operationError = null;
    this.admissionPending = false;
    this.policyReady = false;
    this.state = {
      ...EMPTY_STATE,
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
      this.persist(sessionId);
    } catch (error) {
      this.fail(
        this.operationError === CONFIGURATION_ERROR
          ? this.operationError
          : "Не удалось открыть этот чат.",
        error,
      );
    }
  }

  /** This browser's indexed chat ids, most recently used first. */
  chatIds(): readonly string[] {
    try {
      const raw = this.storage?.getItem(this.chatIndexKey()) ?? "[]";
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return [
        ...new Set(parsed.filter((id): id is string => typeof id === "string")),
      ].slice(0, MAX_INDEXED_CHATS);
    } catch {
      return [];
    }
  }

  /** The bound session id, or null while no chat is bound. */
  activeSessionId(): string | null {
    return this.session === undefined ? null : String(this.session.sessionId);
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
      await this.reset();
      return;
    }
    this.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.unsubscribeConnection();
    this.unbind();
    this.listeners.clear();
  }

  private async ensureSessionNow(): Promise<void> {
    const operation = ++this.generation;
    this.state = {
      ...EMPTY_STATE,
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
        const stored = this.readPersisted();
        if (stored !== null && Object.hasOwn(list.byId, stored)) {
          id = stored;
          restored = true;
        } else if (stored !== null) {
          this.clearPersisted();
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
        await this.bind(id, !restored);
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
        this.clearPersisted();
        id = await this.createSession();
        if (this.disposed || operation !== this.generation) return;
        await this.bind(id);
      }
      if (this.disposed || operation !== this.generation) return;
      if (this.config.session.policy === "browser-persistent") this.persist(id);
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
      this.clearPersisted();
      const created = await this.createSession();
      if (this.disposed || operation !== this.generation) return false;
      await this.bind(created);
      if (this.disposed || operation !== this.generation) return false;
      this.persist(created);
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
      ...(this.config.session.workspaceId === null
        ? {}
        : { workspaceId: this.config.session.workspaceId as WorkspaceId }),
    });
    const id = String(created);
    if (this.config.session.agentPreset !== null) {
      const selectedPreset = await this.api.selectAgentPreset({
        sessionId: id as SessionId,
        agentPreset: this.config.session.agentPreset,
      });
      if (!selectedPreset.result.ok) {
        throw new Error(selectedPreset.result.error.code);
      }
      this.sessions.noteAgentPreset(
        id as SessionId,
        this.config.session.agentPreset,
      );
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
      if (!selected.result.ok) throw new Error(selected.result.error.code);
    }
    return id;
  }

  private async bind(
    id: string,
    reportAttestationFailure = true,
  ): Promise<void> {
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
    this.policyReady = false;
    this.unsubscribeSession = binding.session.subscribe(() => {
      this.admissionPending = false;
      this.operationError = null;
      this.publish();
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
    if (!(await this.attestPolicy(reportAttestationFailure))) {
      throw new QaPolicyAttestationError();
    }
    this.recordChat(String(this.session.sessionId));
    this.publish();
  }

  private unbind(): void {
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    this.session = undefined;
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

  private publish(): void {
    if (this.disposed) return;
    const connected = this.connection.getSnapshot() !== undefined;
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
    const blocked = snapshot.pending.length > 0;
    const error =
      this.operationError ??
      (blocked
        ? "Для этого запроса нужно действие, недоступное в режиме помощника."
        : snapshot.removed || snapshot.openState === "error"
          ? "Этот чат больше недоступен."
          : null);
    const phase = !connected
      ? "reconnecting"
      : blocked
        ? "blocked"
        : snapshot.removed || snapshot.openState === "error"
          ? "error"
          : snapshot.openState !== "open"
            ? "creating"
            : snapshot.running || this.admissionPending
              ? "running"
              : "ready";
    this.state = {
      phase,
      sessionId: String(this.session.sessionId),
      messages: projectTranscript(snapshot, {
        showToolActivity: this.config.ui.showToolActivity,
        showReasoning: this.config.ui.showReasoning,
      }),
      error,
      canSend: connected && phase === "ready" && this.policyReady,
      canStop:
        connected && snapshot.running && this.config.ui.showStop && !blocked,
      chatsRevision: this.chatsRevision,
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
      ...EMPTY_STATE,
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
      const proof = result.value;
      const valid =
        proof.sessionId === String(this.session.sessionId) &&
        proof.enabled &&
        proof.agentPresetMatches &&
        proof.workspaceMatches &&
        proof.modelMatches &&
        proof.sandboxIsReadOnly &&
        proof.approvalIsNever &&
        proof.permissionPreset === this.config.lockdown.permissionPreset &&
        proof.toolPolicyLoaded &&
        JSON.stringify(proof.toolAllowList) ===
          JSON.stringify(this.config.lockdown.toolPolicy.allow);
      if (!valid) return reject("proof-mismatch");
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

  private storageKey(): string {
    return `${this.config.session.storageKey}:v1:${this.config.route.path}:session`;
  }

  private chatIndexKey(): string {
    return `${this.config.session.storageKey}:v1:${this.config.route.path}:chats`;
  }

  /** Move one chat to the front of this browser's index, capping the list. */
  private recordChat(sessionId: string): void {
    try {
      const next = [
        sessionId,
        ...this.chatIds().filter((id) => id !== sessionId),
      ].slice(0, MAX_INDEXED_CHATS);
      this.storage?.setItem(this.chatIndexKey(), JSON.stringify(next));
    } catch {
      // A denied localStorage write must not prevent the bound chat.
    }
  }

  forgetChat(sessionId: string): void {
    try {
      const next = this.chatIds().filter((id) => id !== sessionId);
      this.storage?.setItem(this.chatIndexKey(), JSON.stringify(next));
    } catch {
      // A denied localStorage removal is harmless; the id is revalidated later.
    }
  }

  private readPersisted(): string | null {
    try {
      const value = this.storage?.getItem(this.storageKey())?.trim() ?? "";
      return value === "" ? null : value;
    } catch {
      return null;
    }
  }

  private persist(id: string): void {
    try {
      this.storage?.setItem(this.storageKey(), id);
    } catch {
      // A denied localStorage write must not prevent a real DSH session.
    }
  }

  private clearPersisted(): void {
    try {
      this.storage?.removeItem(this.storageKey());
    } catch {
      // A denied localStorage removal is harmless; the id is revalidated later.
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export type { SessionListState };
