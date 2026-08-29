import { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DraftAutosaveError,
  DraftComposerBridge,
  type DraftComposerBridgeOptions,
} from "../src/client/composer.js";
import type { DraftSession } from "../src/shared/types.js";

function draft(
  id: string,
  sessionId: string,
  text: string,
  revision = 1,
): DraftSession {
  return {
    version: 1,
    id,
    sessionId,
    workspaceId: "workspace-a",
    text,
    createdAt: 1_000,
    updatedAt: 1_000,
    order: 0,
    state: "ready",
    revision,
  };
}

function input() {
  let snapshot = { draft: "" };
  const listeners = new Set<() => void>();
  const setDraft = vi.fn((text: string) => {
    snapshot = { draft: text };
    for (const listener of listeners) listener();
  });
  return {
    face: {
      setDraft,
      notify: vi.fn(),
      state: {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    },
    setDraft,
    edit(text: string) {
      snapshot = { draft: text };
      for (const listener of listeners) listener();
    },
  };
}

function bridgeOptions(
  inputs: ReturnType<typeof input>[],
  update: (...args: never[]) => unknown,
  events: string[] = [],
  observeFinalize: (
    listener: (sessionId: string) => void | Promise<void>,
  ) => () => void = () => () => undefined,
): DraftComposerBridgeOptions {
  let inputIndex = 0;
  return {
    lifecycle: {
      ensureShell: async (value) => value,
      onBeforeFinalize: observeFinalize,
    },
    drafts: { update } as never,
    sessions: {
      open: ((sessionId: string) => {
        events.push(`open:${sessionId}`);
      }) as never,
      scope: (() => new Context()) as never,
    },
    conversation: {
      input: {
        for: (() => inputs[inputIndex++]?.face) as never,
      },
    },
    debounceMs: 350,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DraftComposerBridge", () => {
  it("opens the backing Session and restores exact text through InputHub", async () => {
    const composer = input();
    const events: string[] = [];
    const bridge = new DraftComposerBridge(
      new Context(),
      bridgeOptions([composer], vi.fn(), events),
    );

    const ready = draft("draft-a", "session-a", "  exact\ntext  ");
    await expect(bridge.open(ready)).resolves.toBe(ready);

    expect(events).toEqual(["open:session-a"]);
    expect(composer.setDraft).toHaveBeenCalledWith("  exact\ntext  ");
  });

  it("debounces optimistic autosave and advances the local revision", async () => {
    vi.useFakeTimers();
    const composer = input();
    const current = draft("draft-a", "session-a", "before");
    const update = vi.fn(async (request: Record<string, unknown>) => ({
      ok: true as const,
      value: { ...current, text: request.text as string, revision: 2 },
    }));
    const bridge = new DraftComposerBridge(
      new Context(),
      bridgeOptions([composer], update as never),
    );
    await bridge.open(current);

    composer.edit("after");
    await vi.advanceTimersByTimeAsync(349);
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(update).toHaveBeenCalledWith({
      id: "draft-a",
      expectedRevision: 1,
      text: "after",
    });
    await expect(bridge.flush()).resolves.toMatchObject({
      text: "after",
      revision: 2,
    });
  });

  it("detaches before an accepted Session removes its draft", async () => {
    vi.useFakeTimers();
    const composer = input();
    const update = vi.fn();
    let beforeFinalize:
      ((sessionId: string) => void | Promise<void>) | undefined;
    const bridge = new DraftComposerBridge(
      new Context(),
      bridgeOptions([composer], update, [], (listener) => {
        beforeFinalize = listener;
        return () => {
          beforeFinalize = undefined;
        };
      }),
    );
    await bridge.open(draft("draft-a", "session-a", "send me"));

    await beforeFinalize?.("session-a");
    composer.edit("");
    await vi.advanceTimersByTimeAsync(350);

    expect(update).not.toHaveBeenCalled();
  });

  it("flushes pending autosave before switching Sessions", async () => {
    const firstInput = input();
    const secondInput = input();
    const events: string[] = [];
    const update = vi.fn(async (request: Record<string, unknown>) => {
      events.push(`save:${String(request.id)}:${String(request.text)}`);
      const source = request.id === "draft-a" ? first : second;
      return {
        ok: true as const,
        value: {
          ...source,
          text: request.text as string,
          revision: source.revision + 1,
        },
      };
    });
    const bridge = new DraftComposerBridge(
      new Context(),
      bridgeOptions([firstInput, secondInput], update as never, events),
    );
    const first = draft("draft-a", "session-a", "AAA");
    const second = draft("draft-b", "session-b", "BBB");
    await bridge.open(first);
    firstInput.edit("AAA saved");

    await bridge.open(second);

    expect(events).toEqual([
      "open:session-a",
      "save:draft-a:AAA saved",
      "open:session-b",
    ]);
    expect(secondInput.setDraft).toHaveBeenCalledWith("BBB");
  });

  it("serializes an edit that arrives during an in-flight autosave", async () => {
    const composer = input();
    const current = draft("draft-a", "session-a", "zero");
    let resolveFirst:
      ((result: { ok: true; value: DraftSession }) => void) | undefined;
    const firstSave = new Promise<{ ok: true; value: DraftSession }>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    const update = vi
      .fn()
      .mockImplementationOnce(() => firstSave)
      .mockImplementationOnce(async (request: Record<string, unknown>) => ({
        ok: true as const,
        value: {
          ...current,
          text: request.text as string,
          revision: 3,
        },
      }));
    const bridge = new DraftComposerBridge(
      new Context(),
      bridgeOptions([composer], update as never),
    );
    await bridge.open(current);
    composer.edit("one");

    const flushing = bridge.flush();
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    composer.edit("two");
    resolveFirst?.({
      ok: true,
      value: { ...current, text: "one", revision: 2 },
    });

    await expect(flushing).resolves.toMatchObject({ text: "two", revision: 3 });
    expect(update).toHaveBeenNthCalledWith(1, {
      id: "draft-a",
      expectedRevision: 1,
      text: "one",
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      id: "draft-a",
      expectedRevision: 2,
      text: "two",
    });
  });

  it("surfaces revision conflicts and blocks the Session switch", async () => {
    const firstInput = input();
    const secondInput = input();
    const events: string[] = [];
    const update = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "DRAFT_STALE_REVISION",
        message: "draft changed in another browser",
        details: {},
      },
    }));
    const bridge = new DraftComposerBridge(
      new Context(),
      bridgeOptions([firstInput, secondInput], update as never, events),
    );
    await bridge.open(draft("draft-a", "session-a", "AAA"));
    firstInput.edit("local edit");

    await expect(
      bridge.open(draft("draft-b", "session-b", "BBB")),
    ).rejects.toMatchObject({
      name: "DraftAutosaveError",
      code: "DRAFT_STALE_REVISION",
      localText: "local edit",
    } satisfies Partial<DraftAutosaveError>);
    expect(firstInput.face.notify).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("draft changed in another browser"),
    );
    expect(events).toEqual(["open:session-a"]);
    expect(secondInput.setDraft).not.toHaveBeenCalled();
  });
});
