import type {
  HostDescriptionSource,
  IApiClient,
  SessionId,
} from "@deepseek-ai/dsh-client-connection/client";
import type {
  ConversationSnapshot,
  ISessions,
  SessionFace,
  SessionListState,
} from "@deepseek-ai/dsh-client-runtime/client";
import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import {
  QaSessionController,
  type StorageLike,
} from "../src/client/QaSessionController.js";

class Source<T> {
  private readonly listeners = new Set<() => void>();
  constructor(private value: T) {}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(value: T) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

function conversation(id: string): ConversationSnapshot {
  return {
    sessionId: id as SessionId,
    views: {} as ConversationSnapshot["views"],
    chat: {} as ConversationSnapshot["chat"],
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: "blank",
    removed: false,
    openState: "open",
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: true,
    lastAgentError: null,
  };
}

function sessionFace(id: string) {
  const source = new Source(conversation(id));
  const prompt = vi.fn(async () => ({
    ok: true as const,
    value: { accepted: true as const },
  }));
  const cancel = vi.fn(async () => ({
    ok: true as const,
    value: { accepted: true as const },
  }));
  const face = {
    sessionId: id as SessionId,
    projections: { faceOf: vi.fn() },
    getSnapshot: source.getSnapshot,
    subscribe: source.subscribe,
    prompt,
    cancel,
  } as unknown as SessionFace;
  return { face, source, prompt, cancel };
}

function harness(existing: string[] = []) {
  const faces = new Map(existing.map((id) => [id, sessionFace(id)]));
  const list = new Source<SessionListState>({
    ids: existing as SessionId[],
    byId: Object.fromEntries(
      existing.map((id) => [
        id,
        { id, displayTitle: id, running: false, blank: true, updatedAt: 1 },
      ]),
    ) as SessionListState["byId"],
    current: undefined,
    phase: "ready",
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  });
  const open = vi.fn();
  const sessions = {
    list,
    open,
    binding: (id: SessionId) => {
      const found = faces.get(String(id));
      return found === undefined
        ? undefined
        : { sessionId: id, session: found.face, ctx: {} };
    },
  } as unknown as ISessions;
  let sequence = existing.length;
  const create = vi.fn(async () => {
    const id = `created-${++sequence}`;
    const created = sessionFace(id);
    faces.set(id, created);
    const before = list.getSnapshot();
    list.set({
      ...before,
      ids: [id as SessionId, ...before.ids],
      byId: {
        ...before.byId,
        [id]: {
          id,
          displayTitle: id,
          running: false,
          blank: true,
          updatedAt: 2,
        },
      } as SessionListState["byId"],
    });
    return {
      result: { ok: true as const, value: { sessionId: id as SessionId } },
    };
  });
  const selectModel = vi.fn(async () => ({
    result: { ok: true as const, value: { selected: {} } },
  }));
  const api = { create, selectModel } as unknown as Pick<
    IApiClient["sessions"],
    "create" | "selectModel"
  >;
  const connection = new Source({}) as unknown as HostDescriptionSource;
  const stored = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  };
  return {
    sessions,
    api,
    connection,
    storage,
    stored,
    faces,
    create,
    open,
    list,
  };
}

describe("QA session controller", () => {
  it("restores a valid persisted session without creating one", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "saved",
      canSend: true,
    });
    expect(world.create).not.toHaveBeenCalled();
    expect(world.open).toHaveBeenCalledWith("saved");
    controller.dispose();
  });

  it("replaces a stale id and applies configured model selection", async () => {
    const world = harness();
    world.stored.set("dsh-qa-surface:v1:/qa:session", "gone");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        session: {
          provider: "provider",
          model: "model",
          reasoningEffort: "high",
        },
      }),
    });
    await controller.ensureSession();
    expect(controller.getSnapshot().sessionId).toBe("created-1");
    expect(world.stored.get("dsh-qa-surface:v1:/qa:session")).toBe("created-1");
    expect(world.api.selectModel).toHaveBeenCalledWith({
      sessionId: "created-1",
      provider: "provider",
      model: "model",
      reasoningEffort: "high",
    });
    controller.dispose();
  });

  it("sends plain text, rejects slash commands, and stops generation", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(await controller.send(" hello ")).toBe(true);
    expect(world.faces.get("saved")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "hello" }],
      "queue",
    );
    const saved = world.faces.get("saved");
    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    saved?.source.set({ ...saved.source.getSnapshot(), running: false });
    expect(await controller.send("/settings")).toBe(false);
    expect(controller.getSnapshot().error).toMatch(/Slash commands/u);

    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    await controller.stop();
    expect(saved?.cancel).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("creates a fresh session on reset without deleting the old one", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const first = controller.getSnapshot().sessionId;
    await controller.reset();
    expect(first).toBe("created-1");
    expect(controller.getSnapshot().sessionId).toBe("created-2");
    expect(world.faces.has("created-1")).toBe(true);
    controller.dispose();
  });

  it("blocks prompts when DSH reports a pending interaction", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const saved = world.faces.get("saved");
    saved?.source.set({
      ...saved.source.getSnapshot(),
      pending: [
        { kind: "approval" },
      ] as unknown as ConversationSnapshot["pending"],
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "blocked",
      canSend: false,
      canStop: false,
    });
    expect(await controller.send("do it")).toBe(false);
    expect(saved?.prompt).not.toHaveBeenCalled();
    controller.dispose();
  });
});
