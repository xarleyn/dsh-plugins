import { Service, type Context } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import type { UpdateDraftRequest } from "../shared/types.js";
import type { DraftSession } from "../shared/types.js";

type DraftListRemote = {
  list(request: {
    workspaceId?: string;
  }): Promise<
    | { ok: true; value: DraftSession[] }
    | { ok: false; error: { message: string } }
  >;
};

/** Observable Host-backed draft list used by the sidebar contribution. */
export class DraftSidebarSource extends Service {
  private readonly drafts: DraftListRemote;
  private snapshot: readonly DraftSession[] = [];
  private shellSnapshot: ReadonlySet<SessionId> = new Set();
  private readonly listeners = new Set<() => void>();
  private generation = 0;

  constructor(ctx: Context, drafts?: DraftListRemote) {
    super(ctx, "draftSidebarSource");
    this.drafts = drafts ?? ctx.remote.draftSessions;
    const refresh = () => {
      void this.refresh().catch((error: unknown) => {
        console.error("draft sidebar refresh failed", error);
      });
    };
    ctx.effect(
      () => ctx.sessions.list.subscribe(refresh),
      "draft-sidebar.sessions",
    );
    ctx.effect(
      () => ctx.workspaces.list.subscribe(refresh),
      "draft-sidebar.workspaces",
    );
    refresh();
  }

  getSnapshot = (): readonly DraftSession[] => this.snapshot;

  /** Stable observable snapshot of blank Session shells owned by drafts. */
  getShellSnapshot = (): ReadonlySet<SessionId> => this.shellSnapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async refresh(): Promise<readonly DraftSession[]> {
    const generation = ++this.generation;
    const result = await this.drafts.list({});
    if (!result.ok) throw new Error(result.error.message);
    if (generation === this.generation) this.publish(result.value);
    return this.snapshot;
  }

  accept(draft: DraftSession): void {
    const next = this.snapshot.filter((item) => item.id !== draft.id);
    next.push(draft);
    this.generation += 1;
    this.publish(next);
  }

  remove(draftId: string): void {
    this.generation += 1;
    this.publish(this.snapshot.filter((draft) => draft.id !== draftId));
  }

  private publish(next: readonly DraftSession[]): void {
    this.snapshot = [...next];
    this.shellSnapshot = draftShellSessionIds(this.snapshot);
    for (const listener of this.listeners) listener();
  }
}

/** Collect the blank execution Session ids owned by drafts. */
export function draftShellSessionIds(
  drafts: readonly DraftSession[],
): ReadonlySet<SessionId> {
  return new Set(
    drafts.flatMap((draft) =>
      draft.sessionId === null ? [] : [draft.sessionId as SessionId],
    ),
  );
}

function orderedDrafts(drafts: readonly DraftSession[]): DraftSession[] {
  return [...drafts].sort(
    (left, right) =>
      Number(right.pinned === true) - Number(left.pinned === true) ||
      left.order - right.order ||
      left.id.localeCompare(right.id),
  );
}

/** Build a stable, zero-based optimistic reorder update set. */
export function planDraftReorder(
  drafts: readonly DraftSession[],
  draftId: string,
  beforeDraftId?: string,
): UpdateDraftRequest[] {
  const current = orderedDrafts(drafts);
  const source = current.find((draft) => draft.id === draftId);
  if (source === undefined) throw new Error(`unknown draft "${draftId}"`);
  if (beforeDraftId === draftId) return [];

  const withoutSource = current.filter((draft) => draft.id !== draftId);
  const targetIndex =
    beforeDraftId === undefined
      ? withoutSource.length
      : withoutSource.findIndex((draft) => draft.id === beforeDraftId);
  if (targetIndex < 0) {
    throw new Error(`unknown before draft "${beforeDraftId}"`);
  }
  withoutSource.splice(targetIndex, 0, source);
  return withoutSource.flatMap((draft, order) =>
    draft.order === order
      ? []
      : [
          {
            id: draft.id,
            expectedRevision: draft.revision,
            order,
          },
        ],
  );
}
