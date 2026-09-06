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
} from "@deepseek-ai/dsh-client-runtime/client";
import type { QaSessionState, ResolvedQaSurfaceConfig } from "../types.js";
import { projectTranscript } from "./QaTranscriptAdapter.js";

type QaSessionsApi = Pick<IApiClient["sessions"], "create" | "selectModel">;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface QaSessionControllerOptions {
  readonly sessions: ISessions;
  readonly api: QaSessionsApi;
  readonly connection: HostDescriptionSource;
  readonly config: ResolvedQaSurfaceConfig;
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
});

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
  private readonly sessions: ISessions;
  private readonly api: QaSessionsApi;
  private readonly connection: HostDescriptionSource;
  private readonly config: ResolvedQaSurfaceConfig;
  private readonly storage: StorageLike | undefined;
  private readonly timeoutMs: number;
  private state: QaSessionState = EMPTY_STATE;
  private session: SessionFace | undefined;
  private unsubscribeSession: (() => void) | undefined;
  private readonly unsubscribeConnection: () => void;
  private ensuring: Promise<void> | undefined;
  private operationError: string | null = null;
  private admissionPending = false;
  private connectedOnce: boolean;
  private disposed = false;
  private generation = 0;

  constructor(options: QaSessionControllerOptions) {
    this.sessions = options.sessions;
    this.api = options.api;
    this.connection = options.connection;
    this.config = options.config;
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
      this.operationError =
        "Slash commands are not available in this assistant view.";
      this.publish();
      return false;
    }
    this.operationError = null;
    this.admissionPending = true;
    this.publish();
    try {
      const result = await this.session.prompt(
        [{ type: "text", text: prompt }],
        "queue",
      );
      if (!result.ok) {
        this.admissionPending = false;
        this.operationError = "Your message could not be sent.";
        this.publish();
        return false;
      }
      this.publish();
      return true;
    } catch (error) {
      this.admissionPending = false;
      console.error("dsh-qa-surface: prompt failed", error);
      this.operationError = "Your message could not be sent.";
      this.publish();
      return false;
    }
  }

  async stop(): Promise<void> {
    if (this.session === undefined || !this.state.canStop) return;
    try {
      const result = await this.session.cancel();
      if (!result.ok)
        this.operationError = "The response could not be stopped.";
    } catch (error) {
      console.error("dsh-qa-surface: stop failed", error);
      this.operationError = "The response could not be stopped.";
    }
    this.publish();
  }

  async reset(): Promise<void> {
    if (this.config.session.policy === "fixed") return;
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
    this.state = { ...EMPTY_STATE, phase: "creating" };
    this.emit();
    try {
      await this.waitForConnection();
      const id = await this.createSession();
      if (this.disposed || operation !== this.generation) return;
      this.persist(id);
      await this.bind(id);
    } catch (error) {
      this.fail("Unable to start a new chat.", error);
    }
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
    this.state = { ...EMPTY_STATE, phase: "creating" };
    this.emit();
    try {
      await this.waitForConnection();
      const list = await waitFor(
        this.sessions.list,
        (snapshot) => snapshot.phase === "ready",
        this.timeoutMs,
      );
      let id: string | null = null;
      if (this.config.session.policy === "fixed") {
        id = this.config.session.fixedSessionId;
        if (id === null || !Object.hasOwn(list.byId, id)) {
          throw new Error("Configured fixed session is unavailable.");
        }
      } else if (this.config.session.policy === "browser-persistent") {
        const stored = this.readPersisted();
        if (stored !== null && Object.hasOwn(list.byId, stored)) {
          id = stored;
        } else if (stored !== null) {
          this.clearPersisted();
        }
      }
      if (id === null) {
        id = await this.createSession();
        if (this.config.session.policy === "browser-persistent")
          this.persist(id);
      }
      if (this.disposed || operation !== this.generation) return;
      await this.bind(id);
    } catch (error) {
      this.fail("Unable to start a chat.", error);
    }
  }

  private async createSession(): Promise<string> {
    const response = await this.api.create({
      ...(this.config.session.workspaceId === null
        ? {}
        : { workspaceId: this.config.session.workspaceId as WorkspaceId }),
      ...(this.config.session.agentPreset === null
        ? {}
        : { agentPreset: this.config.session.agentPreset }),
    });
    if (!response.result.ok) throw new Error(response.result.error.code);
    const id = String(response.result.value.sessionId);
    await waitFor(
      this.sessions.list,
      (snapshot) => Object.hasOwn(snapshot.byId, id),
      this.timeoutMs,
    );
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

  private async bind(id: string): Promise<void> {
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
    this.unsubscribeSession = binding.session.subscribe(() => {
      this.admissionPending = false;
      this.operationError = null;
      this.publish();
    });
    this.publish();
  }

  private unbind(): void {
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    this.session = undefined;
    this.admissionPending = false;
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
        ? "This request requires an interaction that is not available in this assistant view."
        : snapshot.removed || snapshot.openState === "error"
          ? "This chat is no longer available."
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
      }),
      error,
      canSend: connected && phase === "ready",
      canStop:
        connected && snapshot.running && this.config.ui.showStop && !blocked,
    };
    this.emit();
  }

  private fail(message: string, error: unknown): void {
    console.error("dsh-qa-surface: session operation failed", error);
    if (this.disposed) return;
    this.operationError = message;
    this.state = {
      ...EMPTY_STATE,
      phase: "error",
      error: message,
    };
    this.emit();
  }

  private storageKey(): string {
    return `${this.config.session.storageKey}:v1:${this.config.route.path}:session`;
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
