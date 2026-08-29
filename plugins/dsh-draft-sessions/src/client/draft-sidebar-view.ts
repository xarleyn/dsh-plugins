import {
  createElement,
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { displayDraftTitle, type DraftSession } from "../shared/types.js";

const CSS = `
.dsd-panel{flex:none;max-height:min(42%,360px);overflow:auto;padding:0 8px 8px;border-bottom:1px solid var(--dsw-alias-border-l3)}
.dsd-panel[data-surface=tab]{flex:1;min-height:0;max-height:none;border-bottom:0}
.dsd-panel[data-surface=popover]{flex:1;min-height:0;max-height:none;border-bottom:0;padding:4px 8px 8px}
.dsd-heading{display:flex;align-items:center;gap:8px;padding:8px 8px 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.04em}
.dsd-heading-label{flex:1;min-width:0}
.dsd-add{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:4px;padding:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:18px/1 sans-serif;cursor:pointer}
.dsd-add:hover,.dsd-add:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);outline:none}
.dsd-row{position:relative;display:flex;align-items:center;gap:6px;height:32px;padding:0 8px;border-radius:8px;box-sizing:border-box;outline:none;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}
.dsd-row:hover,.dsd-row:focus-visible,.dsd-row[data-selected=true],.dsd-row[data-menu=true]{background:var(--dsw-alias-interactive-bg-hover)}
.dsd-row:focus-visible{box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}
.dsd-dot{flex:none;width:8px;height:8px;border:1px dashed currentColor;border-radius:50%;opacity:.72}
.dsd-row[data-state=error] .dsd-dot{border-style:solid;color:var(--dsw-alias-state-error-primary,#d84c4c)}
.dsd-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px}
.dsd-workspace,.dsd-badge{flex:none;max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}
.dsd-badge{max-width:none}
.dsd-actions{position:relative;flex:none}
.dsd-menu-button{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:4px;padding:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsd-menu-button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsd-menu{position:fixed;z-index:2147483001;min-width:132px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-button-elevated-fill));box-shadow:var(--dsw-shadow-l2,0 8px 24px rgba(0,0,0,.18))}
.dsd-menu-item{display:block;width:100%;border:0;border-radius:5px;padding:6px 8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.dsd-menu-item:hover,.dsd-menu-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
.dsd-menu-item[data-danger=true]{color:var(--dsw-alias-state-error-primary,#d84c4c)}
.dsd-confirm{padding:6px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px}
.dsd-confirm-actions{display:flex;gap:4px;padding:2px 4px 4px}
.dsd-rename{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:2px 5px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;outline:none}
.dsd-error{padding:4px 8px;color:var(--dsw-alias-state-error-primary,#d84c4c);font-size:12px;line-height:17px}
.dsd-row[data-drop=before]::before,.dsd-row[data-drop=after]::after{content:"";position:absolute;left:4px;right:4px;height:2px;background:var(--dsw-alias-state-business-primary);pointer-events:none}
.dsd-row[data-drop=before]::before{top:-1px}.dsd-row[data-drop=after]::after{bottom:-1px}
@media(prefers-reduced-motion:reduce){.dsd-row{scroll-behavior:auto}}
`;

export interface DraftDropTarget {
  readonly workspaceId: string;
  readonly beforeDraftId?: string;
}

export interface DraftSidebarViewProps {
  readonly surface?: "inline" | "tab" | "popover";
  readonly drafts: readonly DraftSession[];
  readonly currentSessionId?: string;
  readonly workspaceNames?: Readonly<Record<string, string>>;
  readonly onCreate: () => Promise<void>;
  readonly onOpen: (draft: DraftSession) => void;
  readonly onRename: (draft: DraftSession, title: string) => Promise<void>;
  readonly onDuplicate: (draft: DraftSession) => Promise<void>;
  readonly onDelete: (draft: DraftSession) => Promise<void>;
  readonly onReorder: (
    workspaceId: string,
    draftId: string,
    beforeDraftId?: string,
  ) => Promise<void>;
}

function ordered(drafts: readonly DraftSession[]): DraftSession[] {
  return [...drafts].sort(
    (left, right) =>
      left.workspaceId.localeCompare(right.workspaceId) ||
      Number(right.pinned === true) - Number(left.pinned === true) ||
      left.order - right.order ||
      left.id.localeCompare(right.id),
  );
}

export function resolveDraftDropTarget(
  drafts: readonly DraftSession[],
  sourceId: string,
  targetId: string,
  half: "before" | "after",
): DraftDropTarget | undefined {
  const source = drafts.find((draft) => draft.id === sourceId);
  const target = drafts.find((draft) => draft.id === targetId);
  if (
    source === undefined ||
    target === undefined ||
    source.workspaceId !== target.workspaceId ||
    Boolean(source.pinned) !== Boolean(target.pinned)
  ) {
    return undefined;
  }
  const workspace = ordered(
    drafts.filter((draft) => draft.workspaceId === source.workspaceId),
  );
  const targetIndex = workspace.findIndex((draft) => draft.id === targetId);
  const beforeDraftId =
    half === "before" ? targetId : workspace[targetIndex + 1]?.id;
  return {
    workspaceId: source.workspaceId,
    ...(beforeDraftId === undefined ? {} : { beforeDraftId }),
  };
}

function rowTitle(draft: DraftSession): string {
  return displayDraftTitle(draft) || "Untitled draft";
}

export function DraftSidebarView({
  surface = "inline",
  drafts,
  currentSessionId,
  workspaceNames = {},
  onCreate,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onReorder,
}: DraftSidebarViewProps) {
  const rows = ordered(drafts);
  const [activeId, setActiveId] = useState(() => rows[0]?.id);
  const [menuId, setMenuId] = useState<string>();
  const [confirmingId, setConfirmingId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [renameText, setRenameText] = useState("");
  const [busyId, setBusyId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [draggingId, setDraggingId] = useState<string>();
  const [drop, setDrop] = useState<{
    id: string;
    half: "before" | "after";
  }>();
  const refs = useRef(new Map<string, HTMLDivElement>());
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    readonly top: number;
    readonly right: number;
  }>();

  useEffect(() => {
    if (activeId !== undefined && rows.some((row) => row.id === activeId)) {
      return;
    }
    setActiveId(rows[0]?.id);
  }, [activeId, rows]);

  useLayoutEffect(() => {
    if (menuId === undefined) {
      setMenuPosition(undefined);
      return;
    }
    const place = () => {
      const trigger = actionRefs.current.get(menuId);
      if (trigger === undefined) return;
      const rect = trigger.getBoundingClientRect();
      const panelHeight = menuRef.current?.offsetHeight ?? 0;
      const below = rect.bottom + 4;
      const top =
        below + panelHeight <= window.innerHeight - 8
          ? below
          : Math.max(8, rect.top - panelHeight - 4);
      setMenuPosition({
        top,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [confirmingId, menuId]);

  const focusAt = (index: number) => {
    const next = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (next === undefined) return;
    setActiveId(next.id);
    refs.current.get(next.id)?.focus();
  };
  const beginRename = (draft: DraftSession) => {
    setMenuId(undefined);
    setConfirmingId(undefined);
    setEditingId(draft.id);
    setRenameText(rowTitle(draft));
    setError(undefined);
  };
  const run = (draft: DraftSession, action: () => Promise<void>) => {
    setBusyId(draft.id);
    setError(undefined);
    void action()
      .then(() => {
        setMenuId(undefined);
        setConfirmingId(undefined);
        setEditingId(undefined);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setBusyId(undefined));
  };
  const createDraft = () => {
    setCreating(true);
    setError(undefined);
    void onCreate()
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setCreating(false));
  };
  const keyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    draft: DraftSession,
  ) => {
    if (event.currentTarget !== event.target) return;
    const index = rows.findIndex((row) => row.id === draft.id);
    if (
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      event.preventDefault();
      setConfirmingId(undefined);
      setMenuId(draft.id);
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(rows.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onOpen(draft);
        break;
      case "F2":
        event.preventDefault();
        beginRename(draft);
        break;
      case "Delete":
        event.preventDefault();
        setMenuId(draft.id);
        setConfirmingId(draft.id);
        break;
      case "Escape":
        event.preventDefault();
        setMenuId(undefined);
        setConfirmingId(undefined);
        setEditingId(undefined);
        break;
    }
  };
  const dragOver = (event: DragEvent<HTMLDivElement>, draft: DraftSession) => {
    if (draggingId === undefined) return;
    const source = rows.find((row) => row.id === draggingId);
    if (
      source === undefined ||
      source.workspaceId !== draft.workspaceId ||
      Boolean(source.pinned) !== Boolean(draft.pinned)
    ) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setDrop({
      id: draft.id,
      half: event.clientY < rect.top + rect.height / 2 ? "before" : "after",
    });
  };

  const menuDraft = rows.find((draft) => draft.id === menuId);
  const menu =
    menuDraft === undefined
      ? null
      : createElement(
          "div",
          {
            ref: menuRef,
            className: "dsd-menu",
            role: "menu",
            style:
              menuPosition === undefined
                ? { visibility: "hidden", top: 0, right: 0 }
                : menuPosition,
          },
          confirmingId === menuDraft.id
            ? createElement(
                Fragment,
                null,
                createElement(
                  "div",
                  { className: "dsd-confirm" },
                  "Delete this unsent draft?",
                ),
                createElement(
                  "div",
                  { className: "dsd-confirm-actions" },
                  createElement(
                    "button",
                    {
                      type: "button",
                      className: "dsd-menu-item",
                      onClick: () => setConfirmingId(undefined),
                    },
                    "Cancel",
                  ),
                  createElement(
                    "button",
                    {
                      type: "button",
                      className: "dsd-menu-item",
                      "data-danger": true,
                      onClick: () => run(menuDraft, () => onDelete(menuDraft)),
                    },
                    "Delete",
                  ),
                ),
              )
            : createElement(
                Fragment,
                null,
                createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsd-menu-item",
                    role: "menuitem",
                    onClick: () => beginRename(menuDraft),
                  },
                  "Rename",
                ),
                createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsd-menu-item",
                    role: "menuitem",
                    onClick: () => run(menuDraft, () => onDuplicate(menuDraft)),
                  },
                  "Duplicate",
                ),
                createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsd-menu-item",
                    role: "menuitem",
                    "data-danger": true,
                    onClick: () => setConfirmingId(menuDraft.id),
                  },
                  "Delete…",
                ),
              ),
        );
  return createElement(
    Fragment,
    null,
    createElement("style", null, CSS),
    createElement(
      "section",
      {
        className: "dsd-panel",
        "data-surface": surface,
        "aria-label": "Draft sessions",
      },
      createElement(
        "div",
        { className: "dsd-heading" },
        createElement("span", { className: "dsd-heading-label" }, "Drafts"),
        createElement(
          "button",
          {
            type: "button",
            className: "dsd-add",
            "aria-label": "New draft",
            disabled: creating,
            onClick: createDraft,
          },
          "+",
        ),
      ),
      createElement(
        "div",
        { role: "tree", "aria-label": "Draft sessions" },
        ...rows.map((draft) => {
          const selected = draft.sessionId === currentSessionId;
          const editing = editingId === draft.id;
          const menuOpen = menuId === draft.id;
          const disabled = busyId === draft.id;
          return createElement(
            "div",
            {
              key: draft.id,
              ref: (node: HTMLDivElement | null) => {
                if (node === null) refs.current.delete(draft.id);
                else refs.current.set(draft.id, node);
              },
              className: "dsd-row",
              role: "treeitem",
              tabIndex: activeId === draft.id ? 0 : -1,
              "aria-selected": selected,
              "aria-label": `${rowTitle(draft)}, Draft`,
              "data-selected": selected,
              "data-state": draft.state,
              "data-menu": menuOpen,
              "data-drop": drop?.id === draft.id ? drop.half : undefined,
              draggable: !editing && !disabled,
              onFocus: () => setActiveId(draft.id),
              onClick: () => {
                if (!editing && !menuOpen) onOpen(draft);
              },
              onKeyDown: (event: KeyboardEvent<HTMLDivElement>) =>
                keyDown(event, draft),
              onContextMenu: (event: MouseEvent) => {
                event.preventDefault();
                setMenuId(draft.id);
              },
              onDragStart: (event: DragEvent<HTMLDivElement>) => {
                setDraggingId(draft.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", draft.id);
              },
              onDragOver: (event: DragEvent<HTMLDivElement>) =>
                dragOver(event, draft),
              onDrop: (event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                const sourceId = draggingId;
                const marker = drop;
                setDraggingId(undefined);
                setDrop(undefined);
                if (sourceId === undefined || marker === undefined) return;
                const target = resolveDraftDropTarget(
                  rows,
                  sourceId,
                  marker.id,
                  marker.half,
                );
                if (target === undefined) return;
                void onReorder(
                  target.workspaceId,
                  sourceId,
                  target.beforeDraftId,
                ).catch((cause: unknown) => {
                  setError(
                    cause instanceof Error ? cause.message : String(cause),
                  );
                });
              },
              onDragEnd: () => {
                setDraggingId(undefined);
                setDrop(undefined);
              },
            },
            createElement("span", {
              className: "dsd-dot",
              "aria-hidden": true,
            }),
            editing
              ? createElement("input", {
                  className: "dsd-rename",
                  value: renameText,
                  autoFocus: true,
                  "aria-label": "Draft title",
                  disabled,
                  onClick: (event: MouseEvent) => event.stopPropagation(),
                  onChange: (event: { currentTarget: HTMLInputElement }) =>
                    setRenameText(event.currentTarget.value),
                  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditingId(undefined);
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      const title = renameText.trim();
                      if (title !== "") {
                        run(draft, () => onRename(draft, title));
                      }
                    }
                  },
                })
              : createElement(
                  "span",
                  { className: "dsd-title" },
                  rowTitle(draft),
                ),
            createElement(
              "span",
              { className: "dsd-workspace" },
              workspaceNames[draft.workspaceId] ?? "",
            ),
            createElement(
              "span",
              { className: "dsd-badge" },
              draft.state === "error" ? "Error" : "Draft",
            ),
            createElement(
              "span",
              { className: "dsd-actions" },
              createElement(
                "button",
                {
                  ref: (node: HTMLButtonElement | null) => {
                    if (node === null) actionRefs.current.delete(draft.id);
                    else actionRefs.current.set(draft.id, node);
                  },
                  type: "button",
                  className: "dsd-menu-button",
                  "aria-label": `Actions for ${rowTitle(draft)}`,
                  "aria-expanded": menuOpen,
                  disabled,
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation();
                    setConfirmingId(undefined);
                    setMenuId(menuOpen ? undefined : draft.id);
                  },
                },
                "⋯",
              ),
            ),
          );
        }),
      ),
      error === undefined
        ? null
        : createElement(
            "div",
            { className: "dsd-error", role: "alert" },
            error,
          ),
      menu === null ? null : createPortal(menu, document.body),
    ),
  );
}
