import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  SessionFace,
  SessionListState,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-client-connection/client";
import { describe, expect, it, vi } from "vitest";
import { QA_REGENERATE_MARKER } from "../src/client/QaTranscriptAdapter.js";
import { resolveConfig } from "../src/resolve-config.js";
import {
  QaSessionController,
  type QaSessionControllerOptions,
} from "../src/client/QaSessionController.js";
import type { StorageLike } from "../src/client/types.js";

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

function conversation(_id: string): ConversationSnapshot {
  // No Chat view is registered in tests, so the transcript projects empty.
  return {
    views: { get: () => undefined },
    activeTargets: new Set(),
  };
}

function sessionFace(id: string) {
  const source = new Source({
    running: false,
    openState: "open",
    blank: true,
    removed: false,
  });
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

function conversationBinding(id: string) {
  return {
    snapshot: new Source(conversation(id)),
    // Subscribing the Chat target activates it; tests never register one.
    target: vi.fn(() => new Source(undefined)),
  };
}

function harness(existing: string[] = []) {
  const faces = new Map(existing.map((id) => [id, sessionFace(id)]));
  const bindings = new Map(existing.map((id) => [id, conversationBinding(id)]));
  const list = new Source<SessionListState>({
    ids: existing as never[],
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
    binding: (id: never) => {
      const found = bindings.get(String(id));
      return found === undefined
        ? undefined
        : { sessionId: id, session: faces.get(String(id))?.face, ctx: {} };
    },
  } as unknown as QaSessionControllerOptions["sessions"];
  let sequence = existing.length;
  const create = vi.fn(async () => {
    const id = `created-${++sequence}`;
    faces.set(id, sessionFace(id));
    bindings.set(id, conversationBinding(id));
    const before = list.getSnapshot();
    list.set({
      ...before,
      ids: [id, ...before.ids],
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
    } as SessionListState);
    return id as never;
  });
  Object.assign(sessions, { create });
  const selectModel = vi.fn(async () => ({
    ok: true as const,
    value: { selected: {} },
  }));
  const selectAgentPreset = vi.fn(async () => ({
    ok: true as const,
    value: "qa-assistant",
  }));
  const api = {
    selectModel,
    selectAgentPreset,
  } as unknown as QaSessionControllerOptions["api"];
  const conversation = {
    binding: (id: never) => bindings.get(String(id)),
  } as unknown as QaSessionControllerOptions["conversation"];
  const connection = new Source(
    {},
  ) as unknown as QaSessionControllerOptions["connection"];
  const stored = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  };
  const secureSession = vi.fn<QaSessionControllerOptions["secureSession"]>(
    async (sessionId: string) => ({
      ok: true as const,
      value: {
        sessionId,
        enabled: true,
        agentPresetMatches: true,
        workspaceMatches: true,
        modelMatches: true,
        sandboxIsReadOnly: true,
        approvalIsNever: true,
        permissionPreset: "qa-read-only",
        toolPolicyLoaded: true,
        toolAllowList: [],
      },
    }),
  );
  return {
    sessions,
    api,
    conversation,
    connection,
    storage,
    stored,
    faces,
    bindings,
    create,
    selectAgentPreset,
    open,
    list,
    secureSession,
  };
}

describe("QA session controller", () => {
  it("restores a valid persisted session without creating one", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
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
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "gone");
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
    expect(world.stored.get("dsh-qa-surface.session:v1:/qa:session")).toBe(
      "created-1",
    );
    expect(world.api.selectModel).toHaveBeenCalledWith({
      sessionId: "created-1",
      provider: "provider",
      model: "model",
      reasoningEffort: "high",
    });
    controller.dispose();
  });

  it("replaces a persisted session rejected by the Host policy", async () => {
    const world = harness(["saved"]);
    const storageKey = "dsh-qa-surface.session:v1:/qa:session";
    world.stored.set(storageKey, "saved");
    world.secureSession.mockImplementation(async (sessionId: string) =>
      sessionId === "saved"
        ? {
            ok: false as const,
            error: { code: "policy-unavailable" },
          }
        : {
            ok: true as const,
            value: {
              sessionId,
              enabled: true,
              agentPresetMatches: true,
              workspaceMatches: true,
              modelMatches: true,
              sandboxIsReadOnly: true,
              approvalIsNever: true,
              permissionPreset: "qa-read-only",
              toolPolicyLoaded: true,
              toolAllowList: [],
            },
          },
    );
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });

    await controller.ensureSession();

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "created-2",
      canSend: true,
      error: null,
    });
    expect(world.secureSession).toHaveBeenNthCalledWith(1, "saved");
    expect(world.secureSession).toHaveBeenNthCalledWith(2, "created-2");
    expect(world.stored.get(storageKey)).toBe("created-2");
    controller.dispose();
  });

  it("does not persist a newly created session before policy attestation", async () => {
    const world = harness();
    const storageKey = "dsh-qa-surface.session:v1:/qa:session";
    world.secureSession.mockResolvedValue({
      ok: false as const,
      error: { code: "policy-unavailable" },
    });
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });

    await controller.ensureSession();

    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      canSend: false,
      error: "Настройки помощника недоступны.",
    });
    expect(world.stored.has(storageKey)).toBe(false);
    controller.dispose();
  });

  it("selects a configured agent preset before policy attestation", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        session: { agentPreset: "qa-assistant" },
      }),
    });
    await controller.ensureSession();
    expect(world.selectAgentPreset).toHaveBeenCalledWith(
      "created-1",
      "qa-assistant",
    );
    expect(world.secureSession).toHaveBeenCalledWith("created-1");
    controller.dispose();
  });

  it("sends plain text, rejects slash commands, and stops generation", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
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
    expect(controller.getSnapshot().error).toMatch(/Команды со слешем/u);

    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    await controller.stop();
    expect(saved?.cancel).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("starts a draft on reset and materializes the session on first send", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    expect(controller.getSnapshot().sessionId).toBe("created-1");
    await controller.startDraft();
    expect(world.create).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "idle",
      sessionId: null,
      messages: [],
      canSend: true,
      canStop: false,
    });
    expect(await controller.send("hello draft")).toBe(true);
    expect(world.create).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().sessionId).toBe("created-2");
    expect(world.faces.has("created-1")).toBe(true);
    expect(world.faces.get("created-2")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "hello draft" }],
      "queue",
    );
    controller.dispose();
  });

  it("does not let a second send during draft materialization double-create", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({ lockdown: { allowSessionReset: true } }),
    });
    await controller.ensureSession();
    await controller.startDraft();
    const first = controller.send("one");
    const second = controller.send("two");
    expect(await second).toBe(false);
    expect(await first).toBe(true);
    expect(world.create).toHaveBeenCalledTimes(2);
    expect(world.faces.get("created-2")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "one" }],
      "queue",
    );
    controller.dispose();
  });

  it.each([
    "agentPresetMatches",
    "workspaceMatches",
    "modelMatches",
    "sandboxIsReadOnly",
    "approvalIsNever",
    "toolPolicyLoaded",
  ] as const)("fails closed when %s cannot be proven", async (field) => {
    const world = harness();
    world.secureSession.mockImplementation(async (sessionId: string) => ({
      ok: true as const,
      value: {
        sessionId,
        enabled: true,
        agentPresetMatches: true,
        workspaceMatches: true,
        modelMatches: true,
        sandboxIsReadOnly: true,
        approvalIsNever: true,
        permissionPreset: "qa-read-only",
        toolPolicyLoaded: true,
        toolAllowList: [],
        [field]: false,
      },
    }));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      canSend: false,
      error: "Настройки помощника недоступны.",
    });
    controller.dispose();
  });

  it("re-binds an idled-out session once and admits the prompt", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const opensBefore = world.open.mock.calls.length;
    // First send-time attestation hits an agent whose tool view the Host
    // dismantled; the retry after the re-bind sees a healthy catalog.
    world.secureSession.mockResolvedValueOnce({
      ok: false as const,
      error: {
        code: "internal",
        message:
          "Assistant configuration is unavailable. (reason: unknown-tools)",
        details: {},
      },
    });
    expect(await controller.send("hello")).toBe(true);
    expect(world.open.mock.calls.length).toBe(opensBefore + 1);
    expect(world.faces.get("created-1")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "hello" }],
      "queue",
    );
    controller.dispose();
  });

  it("replaces an unattestable blank session and admits the prompt", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    // Send attestation and the re-bind attestation both hit the dismantled
    // session; the blank-session fallback mints a fresh attested one.
    const refusal = {
      ok: false as const,
      error: {
        code: "internal",
        message:
          "Assistant configuration is unavailable. (reason: unknown-tools)",
        details: {},
      },
    };
    world.secureSession
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal);
    expect(await controller.send("hello")).toBe(true);
    expect(world.create).toHaveBeenCalledTimes(2);
    expect(world.open).toHaveBeenCalledWith("created-2");
    expect(world.faces.get("created-2")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "hello" }],
      "queue",
    );
    controller.dispose();
  });

  it("reports the refusal when recovery keeps failing", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const refusal = {
      ok: false as const,
      error: {
        code: "internal",
        message:
          "Assistant configuration is unavailable. (reason: unknown-tools)",
        details: {},
      },
    };
    world.secureSession
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal);
    expect(await controller.send("hello")).toBe(false);
    expect(world.faces.get("created-1")?.prompt).not.toHaveBeenCalled();
    expect(world.faces.get("created-2")?.prompt).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      error: "Настройки помощника недоступны.",
    });
    controller.dispose();
  });

  it("does not draft a locked session by default", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    await controller.startDraft();
    expect(world.create).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().sessionId).toBe("created-1");
    controller.dispose();
  });

  it("watches a subagent read-only and returns to the chat", async () => {
    const world = harness(["chat-1"]);
    // A subagent child of the chat, known to the host session list.
    const childFace = sessionFace("child-1");
    world.faces.set("child-1", childFace);
    world.bindings.set("child-1", conversationBinding("child-1"));
    const list = world.list.getSnapshot();
    world.list.set({
      ...list,
      byId: {
        ...list.byId,
        "child-1": {
          id: "child-1",
          displayTitle: "Print a greeting",
          running: true,
          blank: false,
          updatedAt: 5,
        },
      } as SessionListState["byId"],
    });
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const chatId = controller.getSnapshot().sessionId;
    expect(chatId).toBe("created-2");
    const secureCallsBefore = world.secureSession.mock.calls.length;

    await controller.viewSubagent("child-1", "Print a greeting");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "child-1",
      canSend: false,
      viewingSubagent: { id: "child-1", title: "Print a greeting" },
    });
    expect(childFace?.prompt).not.toHaveBeenCalled();

    await controller.closeSubagent();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "created-2",
      canSend: true,
      viewingSubagent: null,
    });
    // The subagent bind skipped attestation entirely; returning attests.
    expect(world.secureSession.mock.calls.length).toBe(secureCallsBefore + 1);
    controller.dispose();
  });

  it("creates the chat inside the pinned cwd", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({ session: { cwd: "D:/qa-docs" } }),
    });
    await controller.ensureSession();
    expect(world.create).toHaveBeenCalledWith({ cwd: "D:/qa-docs" });
    controller.dispose();
  });

  it("regenerates by prompting the hidden marker instruction", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const face = world.faces.get("created-1");
    expect(await controller.regenerate()).toBe(true);
    expect(face?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: QA_REGENERATE_MARKER }],
      "queue",
    );
    controller.dispose();
  });
});

describe("QA chat index and switching", () => {
  it("indexes each attested chat for this browser", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(controller.chatIds()).toEqual(["created-1"]);
    expect(
      JSON.parse(
        world.stored.get("dsh-qa-surface.session:v1:/qa:chats") ?? "[]",
      ),
    ).toEqual(["created-1"]);
    controller.dispose();
  });

  it("switches to an indexed chat and re-attests it", async () => {
    const world = harness(["saved"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(controller.getSnapshot().sessionId).toBe("created-2");
    await controller.switchTo("saved");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "saved",
      canSend: true,
    });
    expect(controller.activeSessionId()).toBe("saved");
    expect(controller.chatIds()).toEqual(["saved", "created-2"]);
    expect(world.stored.get("dsh-qa-surface.session:v1:/qa:session")).toBe(
      "saved",
    );
    controller.dispose();
  });

  it("forgets and reports a chat the host no longer lists", async () => {
    const world = harness(["saved"]);
    world.stored.set(
      "dsh-qa-surface.session:v1:/qa:chats",
      JSON.stringify(["gone", "saved"]),
    );
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    await controller.switchTo("gone");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      error: "Не удалось открыть этот чат.",
    });
    expect(controller.chatIds()).toEqual(["created-2", "saved"]);
    controller.dispose();
  });

  it("surfaces an attestation failure without dropping the chat", async () => {
    const world = harness(["saved"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    world.secureSession.mockRejectedValueOnce(new Error("fence"));
    await controller.switchTo("saved");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      error: "Настройки помощника недоступны.",
    });
    expect(controller.chatIds()).toEqual(["created-2"]);
    controller.dispose();
  });

  it("caps and cleans the stored chat index", () => {
    const world = harness();
    const junk = Array.from({ length: 60 }, (_, i) => `chat-${i}`);
    world.stored.set(
      "dsh-qa-surface.session:v1:/qa:chats",
      JSON.stringify(["chat-3", 42, null, "chat-3", ...junk]),
    );
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    const ids = controller.chatIds();
    expect(ids.length).toBeLessThanOrEqual(50);
    expect(ids[0]).toBe("chat-3");
    expect(new Set(ids).size).toBe(ids.length);
    controller.dispose();
  });

  it("ignores switching under a fixed session policy", async () => {
    const world = harness(["saved"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        session: { policy: "fixed", fixedSessionId: "saved" },
      }),
    });
    await controller.ensureSession();
    await controller.switchTo("not-in-the-list");
    expect(world.open).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().sessionId).toBe("saved");
    controller.dispose();
  });
});

describe("attestation diagnostics", () => {
  it("reports the Host reason code once without a wrapper stack trace", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    world.secureSession.mockResolvedValueOnce({
      ok: false as const,
      error: {
        code: "internal",
        message:
          "Assistant configuration is unavailable. (reason: unknown-tools)",
        details: {},
      },
    });
    await controller.ensureSession();
    const texts = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(
      texts.filter((text) => text.includes("policy attestation failed")),
    ).toEqual([
      "dsh-qa-surface: policy attestation failed (reason: unknown-tools). A lockdown.toolPolicy name is not mounted in this session's tool catalog — check the deployment agent preset and the tool's server availability.",
    ]);
    expect(
      texts.filter((text) => text.includes("session operation failed")),
    ).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      error: "Настройки помощника недоступны.",
    });
    errorSpy.mockRestore();
    controller.dispose();
  });

  it("marks a well-formed proof that does not match the client config", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    world.secureSession.mockResolvedValueOnce({
      ok: true as const,
      value: {
        sessionId: "created-1",
        enabled: true,
        agentPresetMatches: true,
        workspaceMatches: true,
        modelMatches: true,
        sandboxIsReadOnly: true,
        approvalIsNever: true,
        permissionPreset: "some-other-preset",
        toolPolicyLoaded: true,
        toolAllowList: [],
      },
    });
    await controller.ensureSession();
    const texts = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(
      texts.some((text) => text.includes("(reason: proof-mismatch)")),
    ).toBe(true);
    errorSpy.mockRestore();
    controller.dispose();
  });
});

it("forgets a non-active chat without touching sessions", async () => {
  const world = harness(["saved"]);
  world.stored.set(
    "dsh-qa-surface.session:v1:/qa:chats",
    JSON.stringify(["saved", "other"]),
  );
  const controller = new QaSessionController({
    ...world,
    config: resolveConfig(),
  });
  await controller.ensureSession();
  await controller.deleteChat("saved");
  expect(world.create).toHaveBeenCalledTimes(1);
  expect(controller.chatIds()).toEqual(["created-2", "other"]);
  expect(controller.getSnapshot().sessionId).toBe("created-2");
  controller.dispose();
});

it("deleting the active chat falls back to a draft without creating a session", async () => {
  const world = harness();
  const controller = new QaSessionController({
    ...world,
    config: resolveConfig({ lockdown: { allowSessionReset: true } }),
  });
  await controller.ensureSession();
  await controller.deleteChat("created-1");
  expect(world.create).toHaveBeenCalledOnce();
  expect(controller.getSnapshot()).toMatchObject({
    phase: "idle",
    sessionId: null,
    canSend: true,
  });
  expect(controller.chatIds()).toEqual([]);
  expect(world.stored.has("dsh-qa-surface.session:v1:/qa:session")).toBe(false);
  controller.dispose();
});

describe("stream update coalescing", () => {
  it("projects running-turn frames at most once per stream interval", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      streamIntervalMs: 25,
    });
    await controller.ensureSession();
    let publishes = 0;
    controller.subscribe(() => {
      publishes += 1;
    });
    const saved = world.faces.get("saved");
    const partialText = (text: string) => ({
      ...saved?.source.getSnapshot(),
      running: true,
      partial: { turn: 0, step: 0, blocks: [{ kind: "text", text }] },
    });
    // Turn start: the first frame of a window projects at once.
    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    expect(publishes).toBe(1);
    // Further frames inside the window are absorbed.
    saved?.source.set(partialText("a") as never);
    saved?.source.set(partialText("ab") as never);
    expect(publishes).toBe(1);
    // After the window passes, the next frame projects again.
    await new Promise((resolve) => setTimeout(resolve, 40));
    saved?.source.set(partialText("abc") as never);
    expect(publishes).toBe(2);
    // Turn completion projects immediately, so the final state never waits.
    saved?.source.set({ ...saved.source.getSnapshot(), running: false });
    expect(publishes).toBe(3);
    controller.dispose();
  });

  it("projects every frame when stream spacing is disabled", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      streamIntervalMs: 0,
    });
    await controller.ensureSession();
    let publishes = 0;
    controller.subscribe(() => {
      publishes += 1;
    });
    const saved = world.faces.get("saved");
    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    expect(publishes).toBe(2);
    controller.dispose();
  });
});
