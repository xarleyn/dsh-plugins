import { Service, type Context } from "@deepseek-ai/cordis";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceId } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
  RemoteFailure,
  RemoteResult,
  TypertRemoteNamespace,
} from "@deepseek-ai/dsh-typert-protocol";
import type {} from "@deepseek-ai/dsh-api-session-controller/remote-events";
import type {
  CreateDraftRequest,
  DraftSession,
  UpdateDraftRequest,
} from "../shared/types.js";
import type { DraftSidebarSource } from "./sidebar.js";

type DraftSessionsRemote = TypertRemoteNamespace<"draftSessions">;
type SessionsApi = Pick<ISessions, "create" | "list" | "refresh">;

/** Subscription seam for the Host Session running-status events. */
export type SessionStatusSource = (
  listener: (sessionId: string, running: boolean) => void,
) => () => void;

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
  /** Session running-status subscription; omitted wires the ctx remote face. */
  readonly status?: SessionStatusSource;
  readonly sidebar?: Pick<DraftSidebarSource, "accept" | "remove">;
}

export type BeforeDraftFinalizeListener = (
  sessionId: string,
) => void | Promise<void>;

function sessionStatusSource(ctx: Context): SessionStatusSource {
  return (listener) => ctx.remote.$on("api-session/status", listener);
}

function failureOf(cause: unknown): Pick<RemoteFailure, "code" | "message"> {
  // SessionCreateError folds the wire failure into `rpcError`; keep its code
  // so consumers can discriminate the same business codes as before.
  const rpcError = (cause as { readonly rpcError?: RemoteFailure } | undefined)
    ?.rpcError;
  const message = cause instanceof Error ? cause.message : String(cause);
  return rpcError ?? { code: "gateway/internal", message };
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
  private readonly beforeFinalizeListeners =
    new Set<BeforeDraftFinalizeListener>();
  private observationQueue = Promise.resolve();

  constructor(ctx: Context, options?: DraftSessionLifecycleOptions) {
    super(ctx, "draftSessionLifecycle");
    this.drafts = options?.drafts ?? ctx.remote.draftSessions;
    this.sessions = options?.sessions ?? ctx.sessions;
    this.sidebar = options?.sidebar;
    const status =
      options?.status ??
      (options === undefined ? sessionStatusSource(ctx) : undefined);
    if (status !== undefined) {
      ctx.effect(
        () =>
          status((sessionId, running) => {
            // A running Session means the Host accepted a prompt for it.
            if (!running) return;
            this.enqueueObservation(() =>
              this.finalizeAcceptedSession(sessionId),
            );
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
    if (
      draft.sessionId !== null &&
      this.sessions.list.getSnapshot().byId[draft.sessionId as SessionId] !==
        undefined
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
    const blankById = new Map(
      Object.entries(this.sessions.list.getSnapshot().byId).map(
        ([sessionId, summary]) => [sessionId, summary.blank],
      ),
    );
    const reconciled: DraftSession[] = [];
    for (const draft of drafts) {
      const blank =
        draft.sessionId === null ? undefined : blankById.get(draft.sessionId);
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
    try {
      // The store may lag the running-status event; re-pull the Host cut first.
      await this.sessions.refresh();
    } catch (cause) {
      throw new DraftLifecycleError("session-list", failureOf(cause), {
        cause,
      });
    }
    const summary =
      this.sessions.list.getSnapshot().byId[sessionId as SessionId];
    if (summary === undefined || summary.blank) return false;

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

    let sessionId: string;
    try {
      // The Host derives the Session's agent preset itself; the draft's
      // stored preset id stays metadata on the durable record.
      sessionId = String(
        await this.sessions.create({
          workspaceId: materializing.workspaceId as WorkspaceId,
        }),
      );
    } catch (cause) {
      const failure = failureOf(cause);
      const failed = await this.markFailed(materializing, failure.message);
      throw new DraftLifecycleError("session-create", failure, {
        draft: failed,
        cause,
      });
    }

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
}
