import { Service, type Context } from "@deepseek-ai/cordis";
import type {
  ISessions,
  SessionListState,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type {
  IWorkspaces,
  WorkspaceSnapshot,
  WorkspaceView,
} from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { DraftSession } from "../shared/types.js";
import type { DraftComposerBridge } from "./composer.js";
import type { DraftSessionLifecycle } from "./lifecycle.js";

interface ShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
  preventDefault(): void;
}

interface ShortcutSource {
  subscribe(listener: (event: ShortcutEvent) => void): () => void;
}

export interface DraftShortcutControllerOptions {
  readonly lifecycle: Pick<DraftSessionLifecycle, "create">;
  readonly composer: Pick<DraftComposerBridge, "flush" | "open">;
  readonly sessions: Pick<ISessions, "list">;
  readonly workspaces: Pick<IWorkspaces, "list">;
  readonly shortcuts?: ShortcutSource;
}

function browserShortcuts(): ShortcutSource | undefined {
  if (typeof window === "undefined") return undefined;
  return {
    subscribe(listener) {
      const receive = (event: KeyboardEvent) => listener(event);
      window.addEventListener("keydown", receive);
      return () => window.removeEventListener("keydown", receive);
    },
  };
}

/**
 * Resolve the same current/recent Workspace axis used by New Session: the
 * current Session's Workspace first, then the most recently active Workspace
 * in Host order (activity mirrors ui-workspace's own fallback).
 */
export function resolveDraftWorkspace(
  sessions: Pick<SessionListState, "current" | "byId" | "phase">,
  workspaces: Pick<WorkspaceSnapshot, "items" | "phase">,
): string | undefined {
  const currentId = sessions.current;
  if (currentId !== undefined) {
    const current = workspaces.items.find((workspace) =>
      workspace.sessionIds.includes(currentId),
    );
    if (current !== undefined) return String(current.workspaceId);
  }
  if (workspaces.phase !== "ready" || sessions.phase !== "ready") {
    return undefined;
  }
  return recentWorkspaceId(workspaces.items, sessions.byId);
}

/** Stable tie-breaking follows Host Workspace order (mirrors ui-workspace). */
function recentWorkspaceId(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState["byId"],
): string | undefined {
  let selected: string | undefined;
  let selectedTime = Number.NEGATIVE_INFINITY;
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY;
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId];
      if (session !== undefined) latest = Math.max(latest, session.updatedAt);
    }
    if (latest === Number.NEGATIVE_INFINITY) {
      latest = Date.parse(workspace.createdAt);
    }
    if (selected === undefined || latest > selectedTime) {
      selected = String(workspace.workspaceId);
      selectedTime = latest;
    }
  }
  return selected;
}

/** Global Ctrl/Cmd+Shift+N action for a distinct draft Session. */
export class DraftShortcutController extends Service {
  private readonly lifecycle: Pick<DraftSessionLifecycle, "create">;
  private readonly composer: Pick<DraftComposerBridge, "flush" | "open">;
  private readonly sessions: Pick<ISessions, "list">;
  private readonly workspaces: Pick<IWorkspaces, "list">;
  private creating = false;

  constructor(ctx: Context, options?: DraftShortcutControllerOptions) {
    super(ctx, "draftShortcutController");
    this.lifecycle = options?.lifecycle ?? ctx.draftSessionLifecycle;
    this.composer = options?.composer ?? ctx.draftComposerBridge;
    this.sessions = options?.sessions ?? ctx.sessions;
    this.workspaces = options?.workspaces ?? ctx.workspaces;
    const shortcuts = options?.shortcuts ?? browserShortcuts();
    if (shortcuts !== undefined) {
      ctx.effect(
        () =>
          shortcuts.subscribe((event) => {
            this.onShortcut(event);
          }),
        "draft-sessions.shortcut",
      );
    }
  }

  /** Flush the current draft, create another, and open its composer. */
  async create(workspaceId?: string): Promise<DraftSession> {
    const target =
      workspaceId ??
      resolveDraftWorkspace(
        this.sessions.list.getSnapshot(),
        this.workspaces.list.getSnapshot(),
      );
    if (target === undefined) {
      throw new Error("cannot create a draft without a current Workspace");
    }
    await this.composer.flush();
    const draft = await this.lifecycle.create({ workspaceId: target });
    await this.composer.open(draft);
    return draft;
  }

  private onShortcut(event: ShortcutEvent): void {
    if (
      event.repeat ||
      event.altKey ||
      !event.shiftKey ||
      (!event.ctrlKey && !event.metaKey) ||
      event.key.toLowerCase() !== "n"
    ) {
      return;
    }
    event.preventDefault();
    if (this.creating) return;
    this.creating = true;
    void this.create()
      .catch((error: unknown) => {
        console.error("draft session shortcut failed", error);
      })
      .finally(() => {
        this.creating = false;
      });
  }
}
