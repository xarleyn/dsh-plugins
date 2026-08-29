import { Service, type Context } from "@deepseek-ai/cordis";
import type {
  ISessions,
  SessionId,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { IConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  RemoteFailure,
  RemoteResult,
  TypertRemoteNamespace,
} from "@deepseek-ai/dsh-typert-protocol";
import type { DraftSession } from "../shared/types.js";
import type { DraftSessionLifecycle } from "./lifecycle.js";
import type { DraftSidebarSource } from "./sidebar.js";

type DraftSessionsRemote = TypertRemoteNamespace<"draftSessions">;
type ComposerInput = ReturnType<IConversation["input"]["for"]>;

interface ActiveDraft {
  draft: DraftSession;
  readonly input: ComposerInput;
  unsubscribe: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  pendingText: string | undefined;
  savingText: string | undefined;
}

export interface DraftComposerBridgeOptions {
  readonly lifecycle: Pick<
    DraftSessionLifecycle,
    "ensureShell" | "onBeforeFinalize"
  >;
  readonly drafts: DraftSessionsRemote;
  readonly sessions: Pick<ISessions, "open" | "scope">;
  readonly conversation: Pick<IConversation, "input">;
  readonly sidebar?: Pick<DraftSidebarSource, "accept">;
  readonly debounceMs?: number;
}

export class DraftAutosaveError extends Error {
  readonly code: string;
  readonly draft: DraftSession;
  readonly localText: string;

  constructor(
    failure: Pick<RemoteFailure, "code" | "message">,
    draft: DraftSession,
    localText: string,
  ) {
    super(`draft autosave failed: ${failure.message}`);
    this.name = "DraftAutosaveError";
    this.code = failure.code;
    this.draft = draft;
    this.localText = localText;
  }
}

function debounceDelay(value: number | undefined): number {
  const resolved = value ?? 350;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError("debounceMs must be a non-negative safe integer");
  }
  return resolved;
}

/** Official InputHub bridge plus serialized optimistic Host autosave. */
export class DraftComposerBridge extends Service {
  private readonly lifecycle: DraftComposerBridgeOptions["lifecycle"];
  private readonly drafts: DraftSessionsRemote;
  private readonly sessions: Pick<ISessions, "open" | "scope">;
  private readonly conversation: Pick<IConversation, "input">;
  private readonly debounceMs: number;
  private readonly sidebar: Pick<DraftSidebarSource, "accept"> | undefined;
  private active: ActiveDraft | undefined;
  private saveQueue = Promise.resolve();

  constructor(ctx: Context, options?: DraftComposerBridgeOptions) {
    super(ctx, "draftComposerBridge");
    this.lifecycle = options?.lifecycle ?? ctx.draftSessionLifecycle;
    this.drafts = options?.drafts ?? ctx.remote.draftSessions;
    this.sessions = options?.sessions ?? ctx.sessions;
    this.conversation = options?.conversation ?? ctx.conversation;
    this.sidebar = options?.sidebar;
    this.debounceMs = debounceDelay(options?.debounceMs);
    ctx.effect(
      () => () => {
        this.detach();
      },
      "draft-sessions.composer",
    );
    ctx.effect(
      () =>
        this.lifecycle.onBeforeFinalize((sessionId) => {
          if (this.active?.draft.sessionId === sessionId) this.detach();
        }),
      "draft-sessions.composer-finalization",
    );
  }

  /** Flush the previous draft, open this Session, and restore exact text. */
  async open(draft: DraftSession): Promise<DraftSession> {
    await this.flush();
    this.detach();

    const ready = await this.lifecycle.ensureShell(draft);
    if (ready.sessionId === null) {
      throw new Error(`draft ${JSON.stringify(ready.id)} has no Session shell`);
    }
    const sessionId = ready.sessionId as SessionId;
    this.sessions.open(sessionId);
    const scope = this.sessions.scope(sessionId);
    if (scope === undefined) {
      throw new Error(
        `draft ${JSON.stringify(ready.id)} Session ${JSON.stringify(ready.sessionId)} has no client scope`,
      );
    }
    const input = this.conversation.input.for(scope);
    input.setDraft(ready.text);

    const active: ActiveDraft = {
      draft: ready,
      input,
      unsubscribe: () => undefined,
      timer: undefined,
      pendingText: undefined,
      savingText: undefined,
    };
    active.unsubscribe = input.state.subscribe(() => {
      this.inputChanged(active);
    });
    this.active = active;
    return ready;
  }

  /** Persist every pending edit before navigation continues. */
  async flush(): Promise<DraftSession | undefined> {
    const active = this.active;
    if (active === undefined) return undefined;
    this.clearTimer(active);
    const result = this.saveQueue.then(
      () => this.drain(active),
      () => this.drain(active),
    );
    this.saveQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Flush and stop mirroring the current composer. */
  async close(): Promise<DraftSession | undefined> {
    const saved = await this.flush();
    this.detach();
    return saved;
  }

  private inputChanged(active: ActiveDraft): void {
    if (this.active !== active) return;
    const text = active.input.state.getSnapshot().draft;
    const expectedText = active.savingText ?? active.draft.text;
    active.pendingText = text === expectedText ? undefined : text;
    this.clearTimer(active);
    if (active.pendingText === undefined) return;
    active.timer = setTimeout(() => {
      active.timer = undefined;
      void this.flush().catch(() => {
        // drain() already surfaced the actionable failure on this composer.
      });
    }, this.debounceMs);
  }

  private async drain(active: ActiveDraft): Promise<DraftSession> {
    while (active.pendingText !== undefined) {
      const text = active.pendingText;
      active.pendingText = undefined;
      active.savingText = text;
      let result: RemoteResult<DraftSession>;
      try {
        result = await this.drafts.update({
          id: active.draft.id,
          expectedRevision: active.draft.revision,
          text,
        });
      } catch (cause) {
        active.savingText = undefined;
        active.pendingText = active.input.state.getSnapshot().draft;
        const message = cause instanceof Error ? cause.message : String(cause);
        const error = new DraftAutosaveError(
          { code: "transport", message },
          active.draft,
          active.pendingText,
        );
        active.input.notify("error", error.message);
        throw error;
      }
      if (!result.ok) {
        active.savingText = undefined;
        active.pendingText = active.input.state.getSnapshot().draft;
        const error = new DraftAutosaveError(
          result.error,
          active.draft,
          active.pendingText,
        );
        active.input.notify("error", error.message);
        throw error;
      }
      active.draft = result.value;
      this.sidebar?.accept(active.draft);
      active.savingText = undefined;
      const liveText = active.input.state.getSnapshot().draft;
      if (active.pendingText === undefined && liveText !== active.draft.text) {
        active.pendingText = liveText;
      }
    }
    return active.draft;
  }

  private clearTimer(active: ActiveDraft): void {
    if (active.timer === undefined) return;
    clearTimeout(active.timer);
    active.timer = undefined;
  }

  private detach(): void {
    const active = this.active;
    if (active === undefined) return;
    this.clearTimer(active);
    active.unsubscribe();
    this.active = undefined;
  }
}
