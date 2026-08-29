import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import {
  DraftShortcutController,
  resolveDraftWorkspace,
  type DraftShortcutControllerOptions,
} from "../src/client/shortcut.js";
import type { DraftSession } from "../src/shared/types.js";

function draft(): DraftSession {
  return {
    version: 1,
    id: "draft-a",
    sessionId: "session-new",
    workspaceId: "workspace-a",
    text: "",
    createdAt: 1_000,
    updatedAt: 1_000,
    order: 0,
    state: "ready",
    revision: 3,
  };
}

function snapshot<T>(value: T) {
  return {
    getSnapshot: () => value,
    subscribe: () => () => undefined,
  };
}

function shortcutSource() {
  let listener:
    | Parameters<
        NonNullable<DraftShortcutControllerOptions["shortcuts"]>["subscribe"]
      >[0]
    | undefined;
  return {
    source: {
      subscribe(next: NonNullable<typeof listener>) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
    press(
      keys: Partial<{
        key: string;
        ctrlKey: boolean;
        metaKey: boolean;
        shiftKey: boolean;
        altKey: boolean;
        repeat: boolean;
      }> = {},
    ) {
      const preventDefault = vi.fn();
      listener?.({
        key: "n",
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        repeat: false,
        preventDefault,
        ...keys,
      });
      return preventDefault;
    },
  };
}

function options(
  overrides: Partial<DraftShortcutControllerOptions> = {},
): DraftShortcutControllerOptions {
  return {
    lifecycle: { create: async () => draft() },
    composer: {
      flush: async () => undefined,
      open: async (value) => value,
    },
    sessions: {
      list: snapshot({ current: "session-a" }) as never,
    },
    workspaces: {
      list: snapshot({
        items: [{ workspaceId: "workspace-a", sessionIds: ["session-a"] }],
        recentWorkspaceId: "workspace-recent",
      }) as never,
    },
    ...overrides,
  };
}

describe("draft shortcut", () => {
  it("prefers the current Session Workspace and falls back to recent", () => {
    const workspaces = {
      items: [
        { workspaceId: "workspace-a", sessionIds: ["session-a"] },
        { workspaceId: "workspace-b", sessionIds: [] },
      ],
      recentWorkspaceId: "workspace-b",
    } as never;

    expect(
      resolveDraftWorkspace({ current: "session-a" } as never, workspaces),
    ).toBe("workspace-a");
    expect(resolveDraftWorkspace({ current: undefined }, workspaces)).toBe(
      "workspace-b",
    );
  });

  it("flushes, creates a distinct draft, and opens it in order", async () => {
    const events: string[] = [];
    const created = draft();
    const controller = new DraftShortcutController(
      new Context(),
      options({
        lifecycle: {
          create: async (request) => {
            events.push(`create:${request.workspaceId}`);
            return created;
          },
        },
        composer: {
          flush: async () => {
            events.push("flush");
            return undefined;
          },
          open: async (value) => {
            events.push(`open:${value.id}`);
            return value;
          },
        },
      }),
    );

    await expect(controller.create()).resolves.toBe(created);
    expect(events).toEqual(["flush", "create:workspace-a", "open:draft-a"]);
  });

  it("handles Ctrl/Cmd+Shift+N once while creation is in flight", async () => {
    const shortcuts = shortcutSource();
    let resolveCreate: ((value: DraftSession) => void) | undefined;
    const pending = new Promise<DraftSession>((resolve) => {
      resolveCreate = resolve;
    });
    const create = vi.fn(() => pending);
    new DraftShortcutController(
      new Context(),
      options({
        lifecycle: { create },
        shortcuts: shortcuts.source,
      }),
    );

    const first = shortcuts.press({ ctrlKey: true });
    const repeated = shortcuts.press({ metaKey: true });

    expect(first).toHaveBeenCalledOnce();
    expect(repeated).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    resolveCreate?.(draft());
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  });

  it("subscribes to browser keydown when production options omit a source", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", { addEventListener, removeEventListener });
    try {
      new DraftShortcutController(new Context(), options());
      expect(addEventListener).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores modified, repeated, and unrelated key presses", () => {
    const shortcuts = shortcutSource();
    const create = vi.fn();
    new DraftShortcutController(
      new Context(),
      options({ lifecycle: { create }, shortcuts: shortcuts.source }),
    );

    expect(shortcuts.press({ key: "x", ctrlKey: true })).not.toHaveBeenCalled();
    expect(
      shortcuts.press({ ctrlKey: true, altKey: true }),
    ).not.toHaveBeenCalled();
    expect(
      shortcuts.press({ ctrlKey: true, repeat: true }),
    ).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
