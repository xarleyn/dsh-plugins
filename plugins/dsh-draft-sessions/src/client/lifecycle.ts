import { Service, type Context } from "@deepseek-ai/cordis";
import type {
  IApiClient,
  RpcError,
  RpcMessage,
  WorkspaceId,
} from "@deepseek-ai/dsh-client-connection/client";
import type {
  RemoteFailure,
  RemoteResult,
  TypertRemoteNamespace,
} from "@deepseek-ai/dsh-typert-protocol";
import type {
  CreateDraftRequest,
  DraftSession,
  UpdateDraftRequest,
} from "../shared/types.js";
import type { DraftSidebarSource } from "./sidebar.js";

type DraftSessionsRemote = TypertRemoteNamespace<"draftSessions">;
type SessionsApi = Pick<IApiClient["sessions"], "create" | "list">;

export interface ApiEnvelopeSource {
  subscribeEnvelopes(
    listener: (batch: readonly RpcMessage[]) => void,
  ): () => void;
}

export type CreateManagedDraftRequest = Omit<CreateDraftRequest, "sessionId">;

export type DraftLifecycleStage =
  | "draft-create"
  | "draft-list"
  | "draft-update"
  | "draft-delete"
  | "session-list"
  | "session-create"
  | "draft-rebind";

/** A lifecycle failure never implies that the durable DraftRecord was removed. */
export class DraftLifecycleError extends Error {
  readonly stage: DraftLifecycleStage;
  readonly code: string;
  readonly draft: DraftSession | undefined;
  readonly sessionId: string | undefined;

  constructor(
    stage: DraftLifecycleStage,
    failure: Pick<RemoteFailure, "code" | "message">,
    options: {
      readonly draft?: DraftSession;
      readonly sessionId?: string;
      readonly cause?: unknown;
    } = {},
  ) {
    super(`${stage}: ${failure.message}`, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "DraftLifecycleError";
    this.stage = stage;
    this.code = failure.code;
    this.draft = options.draft;
    this.sessionId = options.sessionId;
  }
}

export interface DraftSessionLifecycleOptions {
  readonly drafts: DraftSessionsRemote;
  readonly sessions: SessionsApi;
  readonly envelopes?: ApiEnvelopeSource;
  readonly sidebar?: Pick<DraftSidebarSource, "accept" | "remove">;
}

export type BeforeDraftFinalizeListener = (
  sessionId: string,
) => void | Promise<void>;

const MAX_PENDING_PROMPTS = 1_000;

export function envelopeSource(api: IApiClient): ApiEnvelopeSource | undefined {
  const candidate = api as IApiClient & Partial<ApiEnvelopeSource>;
  const subscribeEnvelopes = candidate.subscribeEnvelopes;
  return typeof subscribeEnvelopes === "function"
    ? { subscribeEnvelopes: subscribeEnvelopes.bind(candidate) }
    : undefined;
}

function promptSessionId(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const sessionId = Reflect.get(payload, "sessionId");
  return typeof sessionId === "string" && sessionId !== ""
    ? sessionId
    : undefined;
}

function promptAccepted(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "accepted") === true
  );
}

/**
 * Client-side bridge between durable DraftRecords and real blank DSH Sessions.
 *
 * The DraftRecord is created first with no Session id. A Session id enters the
 * durable record only after `sessions.create` has returned a successful result.
 */
export class DraftSessionLifecycle extends Service {
  private readonly drafts: DraftSessionsRemote;
  private readonly sessions: SessionsApi;
  private readonly sidebar:
    Pick<DraftSidebarSource, "accept" | "remove"> | undefined;
  private readonly pendingPrompts = new Map<string, string>();
  private readonly beforeFinalizeListeners =
    new Set<BeforeDraftFinalizeListener>();
  private observationQueue = Promise.resolve();

  constructor(ctx: Context, options?: DraftSessionLifecycleOptions) {
    super(ctx, "draftSessionLifecycle");
    this.drafts = options?.drafts ?? ctx.remote.draftSessions;
    this.sessions = options?.sessions ?? ctx.connection.api.sessions;
    this.sidebar = options?.sidebar;
    const envelopes =
      options?.envelopes ??
      (options === undefined ? envelopeSource(ctx.connection.api) : undefined);
    if (envelopes !== undefined) {
      ctx.effect(
        () =>
          envelopes.subscribeEnvelopes((batch) => {
            this.observeEnvelopes(batch);
          }),
        "draft-sessions.observe-prompts",
      );
    }
  }

  /** Create a durable draft and give it a distinct blank Session shell. */
  async create(request: CreateManagedDraftRequest): Promise<DraftSession> {
    const created = this.remoteValue(
      await this.drafts.create({
        workspaceId: request.workspaceId,
        ...(request.workspacePath === undefined
          ? {}
          : { workspacePath: request.workspacePath }),
        ...(request.text === undefined ? {} : { text: request.text }),
        ...(request.title === undefined ? {} : { title: request.title }),
        ...(request.order === undefined ? {} : { order: request.order }),
        ...(request.pinned === undefined ? {} : { pinned: request.pinned }),
        ...(request.agentPresetId === undefined
          ? {}
          : { agentPresetId: request.agentPresetId }),
      }),
      "draft-create",
    );
    this.sidebar?.accept(created);
    return this.materialize(created);
  }

  /** Return the draft unchanged when its Session exists, otherwise rebind it. */
  async ensureShell(draft: DraftSession): Promise<DraftSession> {
    const response = await this.sessions.list({});
    if (!response.result.ok) {
      throw this.apiError("session-list", response.result.error, { draft });
    }
    if (
      draft.sessionId !== null &&
      response.result.value.items.some(
        (session: { readonly sessionId: unknown }) =>
          session.sessionId === draft.sessionId,
      )
    ) {
      return draft;
    }
    return this.materialize(draft);
  }

  /** Recover every missing Session shell in one Workspace from one list cut. */
  async reconcileWorkspace(workspaceId: string): Promise<DraftSession[]> {
    const drafts = this.remoteValue(
      await this.drafts.list({ workspaceId }),
      "draft-list",
    );
    const response = await this.sessions.list({});
    if (!response.result.ok) {
      throw this.apiError("session-list", response.result.error);
    }
    const existing = new Map(
      response.result.value.items.map(
        (session: { readonly sessionId: unknown; readonly blank: unknown }) => [
          String(session.sessionId),
          session.blank !== false,
        ],
      ),
    );
    const reconciled: DraftSession[] = [];
    for (const draft of drafts) {
      const blank =
        draft.sessionId === null ? undefined : existing.get(draft.sessionId);
      if (blank === false) {
        await this.deleteDraft(draft);
      } else {
        reconciled.push(blank === true ? draft : await this.materialize(draft));
      }
    }
    return reconciled;
  }

  /** Run cleanup hooks before an accepted Session's durable draft is removed. */
  onBeforeFinalize(listener: BeforeDraftFinalizeListener): () => void {
    this.beforeFinalizeListeners.add(listener);
    return () => {
      this.beforeFinalizeListeners.delete(listener);
    };
  }

  /**
   * Finalize drafts for an accepted prompt only after DSH reports the Session
   * as nonblank. Returns false while the transition is not yet observable.
   */
  async finalizeAcceptedSession(sessionId: string): Promise<boolean> {
    const response = await this.sessions.list({});
    if (!response.result.ok) {
      throw this.apiError("session-list", response.result.error);
    }
    const materialized = response.result.value.items.some(
      (session: { readonly sessionId: unknown; readonly blank: unknown }) =>
        session.sessionId === sessionId && session.blank === false,
    );
    if (!materialized) return false;

    for (const listener of [...this.beforeFinalizeListeners]) {
      await listener(sessionId);
    }

    const drafts = this.remoteValue(await this.drafts.list({}), "draft-list");
    let deleted = false;
    for (const draft of drafts) {
      if (draft.sessionId !== sessionId) continue;
      deleted = (await this.deleteDraft(draft)) || deleted;
    }
    return deleted;
  }

  private async materialize(draft: DraftSession): Promise<DraftSession> {
    const materializing = this.remoteValue(
      await this.drafts.update({
        id: draft.id,
        expectedRevision: draft.revision,
        state: "materializing",
        lastError: null,
      }),
      "draft-update",
      { draft },
    );
    this.sidebar?.accept(materializing);

    let response: Awaited<ReturnType<SessionsApi["create"]>>;
    try {
      response = await this.sessions.create({
        workspaceId: materializing.workspaceId as WorkspaceId,
        ...(materializing.agentPresetId === undefined
          ? {}
          : { agentPreset: materializing.agentPresetId }),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const failed = await this.markFailed(materializing, message);
      throw new DraftLifecycleError(
        "session-create",
        { code: "transport", message },
        { draft: failed, cause },
      );
    }

    if (!response.result.ok) {
      const failed = await this.markFailed(
        materializing,
        response.result.error.message,
      );
      throw this.apiError("session-create", response.result.error, {
        draft: failed,
      });
    }

    const sessionId = String(response.result.value.sessionId);
    const rebound = this.remoteValue(
      await this.drafts.rebind({
        id: materializing.id,
        expectedRevision: materializing.revision,
        sessionId,
      }),
      "draft-rebind",
      { draft: materializing, sessionId },
    );
    this.sidebar?.accept(rebound);
    return rebound;
  }

  private async markFailed(
    draft: DraftSession,
    message: string,
  ): Promise<DraftSession> {
    const request: UpdateDraftRequest = {
      id: draft.id,
      expectedRevision: draft.revision,
      state: "error",
      lastError: message.trim() === "" ? "Session creation failed" : message,
    };
    const result = await this.drafts.update(request);
    const failed = result.ok ? result.value : draft;
    this.sidebar?.accept(failed);
    return failed;
  }

  private async deleteDraft(draft: DraftSession): Promise<boolean> {
    const deleted = this.remoteValue(
      await this.drafts.delete({
        id: draft.id,
        expectedRevision: draft.revision,
      }),
      "draft-delete",
      { draft },
    ).deleted;
    if (deleted) this.sidebar?.remove(draft.id);
    return deleted;
  }

  private observeEnvelopes(batch: readonly RpcMessage[]): void {
    for (const message of batch) {
      const rpcId = String(message.rpcId);
      if (
        message.type === "client-request" &&
        message.method === "session.prompt"
      ) {
        const sessionId = promptSessionId(message.payload);
        if (sessionId === undefined) continue;
        this.pendingPrompts.set(rpcId, sessionId);
        while (this.pendingPrompts.size > MAX_PENDING_PROMPTS) {
          const oldest = this.pendingPrompts.keys().next().value as
            string | undefined;
          if (oldest === undefined) break;
          this.pendingPrompts.delete(oldest);
        }
        continue;
      }
      if (message.type !== "server-response") continue;
      const sessionId = this.pendingPrompts.get(rpcId);
      if (sessionId === undefined) continue;
      this.pendingPrompts.delete(rpcId);
      if (!message.result.ok || !promptAccepted(message.result.value)) continue;
      this.enqueueObservation(() => this.finalizeAcceptedSession(sessionId));
    }
  }

  private enqueueObservation(operation: () => Promise<unknown>): void {
    const result = this.observationQueue.then(operation, operation);
    this.observationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    void result.catch((error: unknown) => {
      console.error("draft session finalization failed", error);
    });
  }

  private remoteValue<T>(
    result: RemoteResult<T>,
    stage: DraftLifecycleStage,
    options: {
      readonly draft?: DraftSession;
      readonly sessionId?: string;
    } = {},
  ): T {
    if (result.ok) return result.value;
    throw new DraftLifecycleError(stage, result.error, options);
  }

  private apiError(
    stage: DraftLifecycleStage,
    error: RpcError,
    options: {
      readonly draft?: DraftSession;
      readonly sessionId?: string;
    } = {},
  ): DraftLifecycleError {
    return new DraftLifecycleError(stage, error, options);
  }
}
