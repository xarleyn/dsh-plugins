import { Context } from "@deepseek-ai/cordis";
import type { CreateAgentOptions } from "@deepseek-ai/dsh-agent";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import { describe, expect, it, vi } from "vitest";
import {
  forkQaSession,
  type QaForkHostOptions,
} from "../../src/session-fork-host.js";
import { resolveConfig } from "../../src/resolve-config.js";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";

function world() {
  const ctx = new Context();
  const events = [
    { seq: 0, time: 1, type: "turn/start", data: { turn: 1 } },
    {
      seq: 1,
      time: 2,
      type: "assistant/message",
      surfaceOp: "append",
      data: {
        stream: [],
        step: 1,
        turn: 1,
        message: {
          id: "answer-1",
          role: "assistant",
          source: {
            kind: "model",
            provider: "demo-provider",
            model: "demo-model",
          },
          content: [{ type: "text", text: "Answer" }],
        },
      },
    },
    {
      seq: 2,
      time: 3,
      type: "turn/end",
      data: { turn: 1, reason: { kind: "done" } },
    },
    { seq: 3, time: 4, type: "turn/start", data: { turn: 2 } },
  ];
  const order: string[] = [];
  const parent = {
    ctx,
    options: { provider: "demo-provider", model: "demo-model" },
    session: { requestHeader: () => undefined },
    cancel: vi.fn(),
    prompt: vi.fn(),
  };
  ctx.provide("sessionProjections", {
    restore: () => ({
      snapshot: { values: { inbox: { "next-turn": [], "next-step": [] } } },
    }),
  } as never);
  const dispose = vi.fn(async () => {
    order.push("dispose");
  });
  const create = vi.fn(async (input: CreateAgentOptions) => {
    order.push("create");
    await input.setup?.(ctx, parent as never);
    const session = Session.create(
      input.sessionId,
      input.seed,
      {
        version: 4,
        isSeeded: true,
        id: input.sessionId,
        createdAt: 10,
        ...input.meta,
      },
      input.inheritedEventCount,
    );
    return { agent: { session }, dispose };
  });
  ctx.provide("agents", { get: () => parent, create } as never);
  const inspect = vi.fn(async () => ({
    meta: { cwd: "/workspace/demo", agentPreset: "demo-preset" },
    events,
  }));
  const selectModel = vi.fn(async () => {
    order.push("model");
  });
  ctx.provide("sessionController", {
    inspect,
    selectModel,
    modelCatalog: async () => ({
      groups: [{ id: "demo-provider", models: [{ id: "demo-model" }] }],
    }),
  } as never);
  const mount = vi.fn(async () => {
    order.push("mount");
  });
  ctx.provide("agentPresets", {
    composedPreset: () => "demo-preset",
    resolve: async () => ({ id: "demo-preset" }),
    mount,
  } as never);
  const attach = vi.fn(async () => {});
  ctx.provide("workspaceRegistry", {
    list: () => [{ sessionIds: [SessionId("parent")], attachSession: attach }],
  } as never);
  const accounts = {
    currentUser: vi.fn(() => ({ id: "owner" })),
    ownerIdOf: vi.fn(() => "owner"),
    sessionAccess: vi.fn(() => ({
      capabilitySnapshot: { tools: ["read"], skills: [] },
    })),
    updateSessionAccess: vi.fn(),
    releaseSessionReservation: vi.fn(),
  };
  const access = {
    isDelegatedChild: vi.fn(() => false),
    session: vi.fn(() => ({
      subrole: { id: "demo-role" },
      adminPreview: false,
    })),
    reserveSession: vi.fn(() => {
      order.push("reserve");
    }),
    modelPolicyFor: vi.fn(() => ({ pair: undefined, layer: undefined })),
  };
  const admission = {
    secureSession: vi.fn(async (_token: string, id: string) => {
      order.push(id === "parent" ? "secure-parent" : "secure-child");
    }),
    preflightDeployment: vi.fn(),
  };
  const principals = { attest: vi.fn() };
  const provenance = { forkSnapshots: vi.fn(), dropSession: vi.fn() };
  const logger = { info: vi.fn(), error: vi.fn() } as unknown as PluginLogger;
  const sessionFiles = {
    erase: vi.fn(async (ids: readonly string[]) => ({
      removed: ids,
      absent: [],
    })),
  };
  const options = {
    sessionFiles,
    ctx,
    config: resolveConfig(),
    accounts,
    access,
    admission,
    principals,
    provenance,
    logger,
  } as unknown as QaForkHostOptions;
  return {
    options,
    events,
    parent,
    create,
    inspect,
    mount,
    dispose,
    selectModel,
    accounts,
    access,
    admission,
    principals,
    provenance,
    attach,
    order,
    sessionFiles,
  };
}

describe("owner-scoped fork transaction", () => {
  it("clears inherited pending input in the seed without touching the parent's queue", async () => {
    const w = world();
    const queued = {
      id: "queued",
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "Future request" }],
    };
    const events = [...w.events];
    events.splice(1, 0, {
      type: "agent/inbox/spliced",
      seq: 1,
      time: 2,
      data: {
        target: "next-turn",
        start: 0,
        removedCount: 0,
        inserted: [queued],
      },
    } as never);
    const source = events.map((event, seq) => ({ ...event, seq }));
    w.inspect.mockResolvedValue({
      meta: { cwd: "/workspace/demo", agentPreset: "demo-preset" },
      events: source,
    });
    Object.assign(w.options.ctx.sessionProjections, {
      restore: () => ({
        snapshot: {
          values: {
            inbox: { "next-turn": [queued], "next-step": [] },
          },
        },
      }),
    });
    await forkQaSession(w.options, "token", "parent", 2);
    const seed = w.create.mock.calls[0]?.[0].seed;
    expect(seed?.slice(0, 4)).toEqual(source.slice(0, 4));
    expect(seed?.at(-1)).toMatchObject({
      type: "agent/inbox/spliced",
      data: {
        target: "next-turn",
        start: 0,
        removedCount: 1,
        inserted: [],
      },
    });
    expect(w.parent.cancel).not.toHaveBeenCalled();
    expect(source[1]?.data).toMatchObject({ inserted: [queued] });
  });
  it("keeps the owner fence if durable rollback cannot prove erasure", async () => {
    const w = world();
    w.admission.secureSession.mockImplementation(async (_token, id) => {
      if (id !== "parent") throw new Error("rejected");
    });
    w.sessionFiles.erase.mockImplementation(async () => ({
      removed: [],
      absent: [],
    }));
    await expect(
      forkQaSession(w.options, "token", "parent", 1),
    ).rejects.toThrow("Unable to fork");
    expect(w.dispose).toHaveBeenCalledTimes(1);
    expect(w.accounts.releaseSessionReservation).not.toHaveBeenCalled();
  });

  it("reserves before publication, composes the same preset, admits and copies only included evidence", async () => {
    const w = world();
    const child = await forkQaSession(w.options, "token", "parent", 1);
    expect(child).toMatch(/^session-/u);
    expect(w.order).toEqual([
      "secure-parent",
      "reserve",
      "create",
      "mount",
      "model",
      "secure-child",
    ]);
    const input = w.create.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      inheritedEventCount: 3,
      meta: { cwd: "/workspace/demo", parentSession: "parent", isSeeded: true },
    });
    expect(input?.seed?.slice(0, 3)).toEqual(w.events.slice(0, 3));
    expect(
      input?.seed?.some(
        (event) => event.type === "turn/start" && event.data.turn === 2,
      ),
    ).toBe(false);
    expect(w.selectModel).toHaveBeenCalledWith({
      sessionId: child,
      provider: "demo-provider",
      model: "demo-model",
    });
    expect(w.access.reserveSession).toHaveBeenCalledWith(
      "token",
      child,
      "demo-role",
      false,
    );
    expect(w.accounts.updateSessionAccess).toHaveBeenCalledWith(child, {
      capabilitySnapshot: { tools: ["read"], skills: [] },
    });
    expect(w.provenance.forkSnapshots).toHaveBeenCalledWith("parent", child, 1);
    expect(w.principals.attest).toHaveBeenCalledWith(child, "owner", "owner");
    expect(w.parent.cancel).not.toHaveBeenCalled();
    expect(w.parent.prompt).not.toHaveBeenCalled();
    expect(w.dispose).not.toHaveBeenCalled();
  });
  it("denies copying a foreign chat before reading or activating it, including admin inspection", async () => {
    const w = world();
    w.accounts.currentUser.mockReturnValue({ id: "admin" });
    await expect(
      forkQaSession(w.options, "token", "parent", 1),
    ).rejects.toThrow("Only the chat owner");
    expect(w.inspect).not.toHaveBeenCalled();
    expect(w.create).not.toHaveBeenCalled();
  });
  it("refuses fixed and delegated sessions without creating a child", async () => {
    const w = world();
    w.access.isDelegatedChild.mockReturnValue(true);
    await expect(
      forkQaSession(w.options, "token", "parent", 1),
    ).rejects.toThrow("delegated");
    await expect(
      forkQaSession(
        {
          ...w.options,
          config: resolveConfig({
            session: { policy: "fixed", fixedSessionId: "parent" },
          }),
        },
        "token",
        "parent",
        1,
      ),
    ).rejects.toThrow("Fixed");
    expect(w.create).not.toHaveBeenCalled();
  });
  it.each(["admission", "sources"])(
    "rolls back only the new child after failed %s",
    async (failure) => {
      const w = world();
      if (failure === "admission")
        w.admission.secureSession.mockImplementation(async (_token, id) => {
          if (id !== "parent") throw new Error("rejected");
        });
      else
        w.provenance.forkSnapshots.mockImplementation(() => {
          throw new Error("rejected");
        });
      await expect(
        forkQaSession(w.options, "token", "parent", 1),
      ).rejects.toThrow("Unable to fork");
      const child = String(w.create.mock.calls[0]?.[0].sessionId);
      expect(w.dispose).toHaveBeenCalledTimes(1);
      expect(w.accounts.releaseSessionReservation).toHaveBeenCalledWith(
        "owner",
        child,
      );
      expect(w.principals.attest).toHaveBeenLastCalledWith(
        child,
        undefined,
        undefined,
      );
      expect(w.provenance.dropSession).toHaveBeenCalledWith(child);
      expect(w.parent.cancel).not.toHaveBeenCalled();
    },
  );
});
