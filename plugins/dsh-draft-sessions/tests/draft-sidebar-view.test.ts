// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DraftSidebarView,
  resolveDraftDropTarget,
  type DraftSidebarViewProps,
} from "../src/client/draft-sidebar-view.js";
import type { DraftSession } from "../src/shared/types.js";

afterEach(cleanup);

function draft(
  id: string,
  order: number,
  overrides: Partial<DraftSession> = {},
): DraftSession {
  return {
    version: 1,
    id,
    sessionId: `shell-${id}`,
    workspaceId: "workspace-a",
    text: `Task ${id}`,
    createdAt: 1_000,
    updatedAt: 1_000,
    order,
    state: "ready",
    revision: order + 1,
    ...overrides,
  };
}

function props(
  overrides: Partial<DraftSidebarViewProps> = {},
): DraftSidebarViewProps {
  return {
    drafts: [draft("a", 0), draft("b", 1)],
    currentSessionId: "shell-a",
    workspaceNames: { "workspace-a": "dsh" },
    onCreate: vi.fn(async () => undefined),
    onOpen: vi.fn(),
    onRename: vi.fn(async () => undefined),
    onDuplicate: vi.fn(async () => undefined),
    onDelete: vi.fn(async () => undefined),
    onReorder: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("draft sidebar view", () => {
  it("creates a distinct draft from the section action", async () => {
    const options = props();
    render(createElement(DraftSidebarView, options));

    fireEvent.click(screen.getByRole("button", { name: "New draft" }));

    await waitFor(() => expect(options.onCreate).toHaveBeenCalledOnce());
  });

  it("renders muted draft semantics and selection", () => {
    render(createElement(DraftSidebarView, props()));

    const rows = screen.getAllByRole("treeitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("aria-selected")).toBe("true");
    expect(rows[0]?.getAttribute("data-state")).toBe("ready");
    expect(rows[0]?.querySelector(".dsd-dot")).not.toBeNull();
    expect(screen.getAllByText("Draft")).toHaveLength(2);
    expect(screen.queryByText("Archive")).toBeNull();
  });

  it("supports roving keyboard navigation and inline rename", async () => {
    const options = props();
    render(createElement(DraftSidebarView, options));
    const rows = screen.getAllByRole("treeitem");
    rows[0]?.focus();

    fireEvent.keyDown(rows[0] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1] as HTMLElement, { key: "Enter" });
    expect(options.onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b" }),
    );

    fireEvent.keyDown(rows[1] as HTMLElement, { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Draft title" });
    fireEvent.change(input, { target: { value: "Renamed draft" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(options.onRename).toHaveBeenCalledWith(
        expect.objectContaining({ id: "b" }),
        "Renamed draft",
      ),
    );
  });

  it("opens and dismisses the context menu from the keyboard", () => {
    render(createElement(DraftSidebarView, props()));
    const row = screen.getAllByRole("treeitem")[0] as HTMLElement;
    row.focus();

    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).not.toBeNull();
    fireEvent.keyDown(row, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.keyDown(row, { key: "Delete" });
    expect(screen.getByText("Delete this unsent draft?")).not.toBeNull();
  });

  it("offers duplicate and confirmed delete actions", async () => {
    const options = props({ drafts: [draft("a", 0)] });
    render(createElement(DraftSidebarView, options));

    fireEvent.click(screen.getByRole("button", { name: "Actions for Task a" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() =>
      expect(options.onDuplicate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "a" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for Task a" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(screen.getByText("Delete this unsent draft?")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(options.onDelete).toHaveBeenCalledWith(
        expect.objectContaining({ id: "a" }),
      ),
    );
  });

  it("portals the row menu outside the scrolling draft panel", () => {
    render(createElement(DraftSidebarView, props()));

    fireEvent.click(screen.getByRole("button", { name: "Actions for Task a" }));

    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    expect(
      screen.getByRole("region", { name: "Draft sessions" }).contains(menu),
    ).toBe(false);
  });

  it("reorders compatible rows with native drag and drop", async () => {
    const options = props();
    render(createElement(DraftSidebarView, options));
    const rows = screen.getAllByRole("treeitem");
    const dataTransfer = {
      effectAllowed: "none",
      setData: vi.fn(),
    };

    fireEvent.dragStart(rows[0] as HTMLElement, { dataTransfer });
    fireEvent.dragOver(rows[1] as HTMLElement, { dataTransfer });
    fireEvent.drop(rows[1] as HTMLElement, { dataTransfer });

    await waitFor(() =>
      expect(options.onReorder).toHaveBeenCalledWith(
        "workspace-a",
        "a",
        undefined,
      ),
    );
  });
});

describe("draft drop target", () => {
  it("rejects cross-workspace and pinned-boundary drops", () => {
    const drafts = [
      draft("a", 0),
      draft("b", 1, { workspaceId: "workspace-b" }),
      draft("p", 2, { pinned: true }),
    ];
    expect(resolveDraftDropTarget(drafts, "a", "b", "before")).toBeUndefined();
    expect(resolveDraftDropTarget(drafts, "a", "p", "before")).toBeUndefined();
    expect(
      resolveDraftDropTarget(
        [draft("a", 0), draft("b", 1)],
        "b",
        "a",
        "before",
      ),
    ).toEqual({ workspaceId: "workspace-a", beforeDraftId: "a" });
  });
});
