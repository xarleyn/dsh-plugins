import type { Context } from "@deepseek-ai/cordis";
import type {
  SessionListState,
  SessionId,
  WorkspaceListState,
} from "@deepseek-ai/dsh-client-runtime/client";
import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type FC,
} from "react";
import { createPortal } from "react-dom";
import type { DraftSession } from "../shared/types.js";
import { DraftSidebarView } from "./draft-sidebar-view.js";
import { planDraftReorder, type DraftSidebarSource } from "./sidebar.js";

type SelectorHook<State> = <Selected>(
  selector: (state: State) => Selected,
) => Selected;

interface DraftContributionProps {
  readonly wide: boolean;
  readonly surface?: "inline" | "tab" | "popover";
  readonly useDrafts: SelectorHook<readonly DraftSession[]>;
  readonly useSessions: SelectorHook<SessionListState>;
  readonly useWorkspaces: SelectorHook<WorkspaceListState>;
}

interface DraftFooterProps {
  readonly wide: boolean;
  readonly useSessions: SelectorHook<SessionListState>;
  readonly useWorkspaces: SelectorHook<WorkspaceListState>;
}

interface ComposableSlots {
  inject(name: string, callback: () => () => void): () => void;
  register(
    options: Record<string, unknown>,
    component: ComponentType<DraftContributionProps>,
  ): () => void;
  entries?(name: string): readonly unknown[];
  entriesOfSlot?(name: string): readonly unknown[];
  subscribe?(name: string, listener: () => void): () => void;
}

/** Native sidebar-tab cooperation protocol shared by ecosystem plugins. */
export const NATIVE_TABS_KEY = "__dshNativeTabs";

interface NativeSidebarTab {
  readonly id: string;
  readonly label: string;
  readonly order?: number;
  matchSession?(sessionId: SessionId): boolean;
  render(props: Record<string, unknown>): unknown;
}

interface NativeTabRegistry {
  readonly version: 1;
  getTabs(): NativeSidebarTab[];
  subscribe(listener: () => void): () => void;
  insert(tab: NativeSidebarTab): () => void;
  addSessionFilter?(filter: (sessionId: SessionId) => boolean): () => void;
}

type IntegrationMode = "footer" | "tab";

class IntegrationModeSource {
  private snapshot: IntegrationMode = "footer";
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): IntegrationMode => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(next: IntegrationMode): void {
    if (next === this.snapshot) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

const FOOTER_CSS = `
.dsd-footer{position:relative;display:flex;align-items:center;width:100%;height:42px;margin:8px 0 0}
.dsd-footer[data-rail=true]{width:36px;height:36px;margin:0}
.dsd-footer-trigger{display:inline-flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:0 -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:14px/20px inherit;cursor:pointer;overflow:hidden}
.dsd-footer-trigger:hover,.dsd-footer-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.dsd-footer[data-rail=true] .dsd-footer-trigger{justify-content:center;width:36px;height:36px;margin:0;padding:0;border-radius:50%}
.dsd-footer-icon{flex:none;width:12px;height:12px;border:1px dashed currentColor;border-radius:50%}
.dsd-footer-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd-footer-count{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsd-footer-panel{position:fixed;z-index:2147483000;display:flex;flex-direction:column;width:320px;max-width:calc(100vw - 24px);max-height:60vh;overflow:hidden;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-elevated));box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.22))}
`;

function findNativeTabRegistry(target: unknown): NativeTabRegistry | undefined {
  if (
    target === undefined ||
    target === null ||
    (typeof target !== "object" && typeof target !== "function")
  ) {
    return undefined;
  }
  const registry = (target as Record<string, unknown>)[NATIVE_TABS_KEY];
  if (
    registry === undefined ||
    registry === null ||
    typeof registry !== "object"
  ) {
    return undefined;
  }
  const candidate = registry as Partial<NativeTabRegistry>;
  return candidate.version === 1 &&
    typeof candidate.getTabs === "function" &&
    typeof candidate.subscribe === "function" &&
    typeof candidate.insert === "function"
    ? (candidate as NativeTabRegistry)
    : undefined;
}

function registryFromEntry(entry: unknown): NativeTabRegistry | undefined {
  return (
    findNativeTabRegistry(entry) ??
    findNativeTabRegistry(
      (entry as { component?: unknown } | undefined)?.component,
    )
  );
}

function draftSelector(
  source: DraftSidebarSource,
): SelectorHook<readonly DraftSession[]> {
  return function useDrafts<Selected>(
    selector: (state: readonly DraftSession[]) => Selected,
  ): Selected {
    return selector(
      useSyncExternalStore(
        source.subscribe,
        source.getSnapshot,
        source.getSnapshot,
      ),
    );
  };
}

/** Build the additive draft rows while leaving the workspace browser intact. */
export function createDraftWorkspaceContribution(
  ctx: Context,
  source: DraftSidebarSource,
): FC<DraftContributionProps> {
  return function DraftWorkspaceContribution({
    wide,
    surface = "inline",
    useDrafts,
    useSessions,
    useWorkspaces,
  }) {
    const drafts = useDrafts((value) => value);
    const currentSessionId = useSessions((state) => state.current);
    const workspaceNames = Object.fromEntries(
      useWorkspaces((state) => state.items).map((workspace) => [
        String(workspace.workspaceId),
        workspace.title,
      ]),
    );
    if (!wide) return null;

    const rename = async (draft: DraftSession, title: string) => {
      const result = await ctx.remote.draftSessions.update({
        id: draft.id,
        expectedRevision: draft.revision,
        title,
      });
      if (!result.ok) throw new Error(result.error.message);
      source.accept(result.value);
    };
    const duplicate = async (draft: DraftSession) => {
      const created = await ctx.draftSessionLifecycle.create({
        workspaceId: draft.workspaceId,
        text: draft.text,
        ...(draft.title === undefined ? {} : { title: draft.title }),
      });
      source.accept(created);
      await ctx.draftComposerBridge.open(created);
    };
    const remove = async (draft: DraftSession) => {
      const isCurrent =
        draft.sessionId !== null && draft.sessionId === currentSessionId;
      const saved = isCurrent
        ? ((await ctx.draftComposerBridge.close()) ?? draft)
        : draft;
      let result: Awaited<ReturnType<typeof ctx.remote.draftSessions.delete>>;
      try {
        result = await ctx.remote.draftSessions.delete({
          id: saved.id,
          expectedRevision: saved.revision,
        });
      } catch (cause) {
        if (isCurrent) {
          await ctx.draftComposerBridge.open(saved).catch(() => undefined);
        }
        throw cause;
      }
      if (!result.ok) {
        if (isCurrent) {
          await ctx.draftComposerBridge.open(saved).catch(() => undefined);
        }
        throw new Error(result.error.message);
      }
      source.remove(draft.id);
      if (isCurrent) ctx.sessions.clear();
    };
    const reorder = async (
      workspaceId: string,
      draftId: string,
      beforeDraftId?: string,
    ) => {
      const workspaceDrafts = drafts.filter(
        (draft) => draft.workspaceId === workspaceId,
      );
      for (const update of planDraftReorder(
        workspaceDrafts,
        draftId,
        beforeDraftId,
      )) {
        const result = await ctx.remote.draftSessions.update(update);
        if (!result.ok) throw new Error(result.error.message);
        source.accept(result.value);
      }
    };

    return createElement(DraftSidebarView, {
      surface,
      drafts,
      ...(currentSessionId === undefined ? {} : { currentSessionId }),
      workspaceNames,
      onCreate: async () => {
        await ctx.draftShortcutController.create();
      },
      onOpen: (draft) => {
        void ctx.draftComposerBridge.open(draft).catch((error: unknown) => {
          console.error("draft open failed", error);
        });
      },
      onRename: rename,
      onDuplicate: duplicate,
      onDelete: remove,
      onReorder: reorder,
    });
  };
}

function createDraftFooterAction(
  ctx: Context,
  source: DraftSidebarSource,
  mode: IntegrationModeSource,
): FC<DraftFooterProps> {
  const DraftPanel = createDraftWorkspaceContribution(ctx, source);
  const useDrafts = draftSelector(source);
  return function DraftFooterAction({ wide, useSessions, useWorkspaces }) {
    const integration = useSyncExternalStore(
      mode.subscribe,
      mode.getSnapshot,
      mode.getSnapshot,
    );
    const drafts = useSyncExternalStore(
      source.subscribe,
      source.getSnapshot,
      source.getSnapshot,
    );
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const [anchor, setAnchor] = useState<{
      readonly left: number;
      readonly bottom: number;
    }>();

    useEffect(() => {
      if (integration === "tab") setOpen(false);
    }, [integration]);
    useLayoutEffect(() => {
      if (!open) return;
      const place = () => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (rect === undefined) return;
        setAnchor({
          left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)),
          bottom: window.innerHeight - rect.top + 8,
        });
      };
      place();
      window.addEventListener("resize", place);
      return () => window.removeEventListener("resize", place);
    }, [open]);
    useEffect(() => {
      if (!open) return;
      const dismiss = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (rootRef.current?.contains(target) === true) return;
        if (panelRef.current?.contains(target) === true) return;
        setOpen(false);
      };
      document.addEventListener("pointerdown", dismiss);
      return () => document.removeEventListener("pointerdown", dismiss);
    }, [open]);

    if (integration === "tab") return null;
    const panel =
      open && anchor !== undefined && typeof document !== "undefined"
        ? createPortal(
            createElement(
              "section",
              {
                ref: panelRef,
                className: "dsd-footer-panel",
                style: anchor,
                "aria-label": "Draft sessions",
              },
              createElement(DraftPanel, {
                wide: true,
                surface: "popover",
                useDrafts,
                useSessions,
                useWorkspaces,
              }),
            ),
            document.body,
          )
        : null;
    return createElement(
      "div",
      {
        ref: rootRef,
        className: "dsd-footer",
        "data-rail": !wide,
      },
      createElement("style", null, FOOTER_CSS),
      createElement(
        "button",
        {
          type: "button",
          className: "dsd-footer-trigger",
          "aria-label": `Drafts (${drafts.length})`,
          "aria-expanded": open,
          onClick: () => setOpen((value) => !value),
        },
        createElement("span", {
          className: "dsd-footer-icon",
          "aria-hidden": true,
        }),
        wide
          ? createElement("span", { className: "dsd-footer-label" }, "Drafts")
          : null,
        wide
          ? createElement(
              "span",
              { className: "dsd-footer-count" },
              drafts.length,
            )
          : null,
      ),
      panel,
    );
  };
}

function workspaceEntries(slots: ComposableSlots): readonly unknown[] {
  try {
    return (
      (slots.entriesOfSlot ?? slots.entries)?.call(
        slots,
        "sidebar.workspaces",
      ) ?? []
    );
  } catch {
    return [];
  }
}

/**
 * Cooperate with an ecosystem native-tab host when present and otherwise use
 * the stock additive footer seat. The workspace-browser single slot remains
 * owned by ui-workspace, Archive Manager, or whichever browser is active.
 */
export function activateWorkspaceContribution(
  ctx: Context,
  source: DraftSidebarSource,
): "activated" {
  const slots = ctx.slots as unknown as ComposableSlots;
  const mode = new IntegrationModeSource();
  const useDrafts = draftSelector(source);
  const DraftPanel = createDraftWorkspaceContribution(ctx, source);

  slots.inject("sidebar.footer.action", () =>
    slots.register(
      {
        name: "sidebar.footer.action",
        id: "dsh-draft-sessions",
        order: 40,
      },
      createDraftFooterAction(ctx, source, mode),
    ),
  );
  slots.inject("sidebar.workspaces", () => {
    let activeRegistry: NativeTabRegistry | undefined;
    let removeTab: () => void = () => undefined;
    let removeSessionFilter: () => void = () => undefined;

    const reconcile = () => {
      const registry = workspaceEntries(slots)
        .map(registryFromEntry)
        .find((value) => value !== undefined);
      if (registry === activeRegistry) return;
      removeTab();
      removeSessionFilter();
      removeTab = () => undefined;
      removeSessionFilter = () => undefined;
      activeRegistry = registry;
      if (registry === undefined) {
        mode.set("footer");
        return;
      }
      removeTab = registry.insert({
        id: "drafts",
        label: "Drafts",
        order: 20,
        matchSession: (sessionId) => source.getShellSnapshot().has(sessionId),
        render: (props) =>
          createElement(DraftPanel, {
            ...(props as unknown as DraftContributionProps),
            wide: true,
            surface: "tab",
            useDrafts,
          }),
      });
      removeSessionFilter =
        registry.addSessionFilter?.(
          (sessionId) => !source.getShellSnapshot().has(sessionId),
        ) ?? (() => undefined);
      mode.set("tab");
    };

    reconcile();
    const unsubscribe =
      slots.subscribe?.("sidebar.workspaces", reconcile) ?? (() => undefined);
    const timer = setInterval(reconcile, 500);
    (timer as unknown as { unref?: () => void }).unref?.();
    return () => {
      clearInterval(timer);
      unsubscribe();
      removeTab();
      removeSessionFilter();
      mode.set("footer");
    };
  });
  return "activated";
}
