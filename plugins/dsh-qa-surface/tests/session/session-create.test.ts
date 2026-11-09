import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  createQaSession,
  type QaSessionCreateOptions,
} from "../../src/session-create.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function world() {
  const cwd = mkdtempSync(path.join(tmpdir(), "qa-create-"));
  cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
  const ctx = new Context();
  cleanups.push(() => ctx.fiber.dispose());
  const order: string[] = [],
    agents = new Map<string, unknown>(),
    membership = new Set<string>();
  let createdId = "";
  const attach = vi.fn(async (id: string) => {
    order.push("attach");
    membership.add(id);
  });
  const detach = vi.fn(async (id: string) => {
    order.push("detach");
    membership.delete(id);
  });
  const dispose = vi.fn(async () => {
    order.push("dispose");
    agents.delete(createdId);
  });
  const create = vi.fn(
    async (request: {
      sessionId: string;
      cwd?: string;
      agentPreset?: string;
    }) => {
      order.push("native-create");
      createdId = request.sessionId;
      const agent = { session: { id: createdId } };
      agents.set(createdId, agent);
      try {
        await ctx.serial("agent/created", {
          agent: agent as never,
          source: "startup",
        });
        return { sessionId: createdId };
      } catch (cause) {
        await dispose().catch(() => {});
        throw new Error("Host creation wrapper", { cause });
      }
    },
  );
  ctx.provide("workspaceRegistry", {
    get: () => ({ path: cwd, attachSession: attach, detachSession: detach }),
  } as never);
  ctx.provide("agents", { get: (id: string) => agents.get(id) } as never);
  ctx.provide("sessions", { get: (id: string) => agents.get(id) } as never);
  ctx.provide("sessionController", {
    create,
    modelCatalog: async () => ({
      groups: [{ id: "demo", models: [{ id: "role-model" }] }],
    }),
    selectModel: vi.fn(async () => {
      order.push("select");
    }),
  } as never);
  const original = new Error("admission refused");
  const options: QaSessionCreateOptions = {
    ctx,
    config: resolveConfig({
      session: { workspaceId: "workspace-demo", agentPreset: "qa-preset" },
    }),
    logger: { info: vi.fn(), error: vi.fn() } as never,
    sessionFiles: {
      erase: vi.fn(async (ids: readonly string[]) => {
        order.push("erase");
        expect([...agents.keys()]).toEqual([]);
        return { removed: ids, absent: [] };
      }),
    },
    reserve: vi.fn(() => {
      order.push("reserve");
      return { id: "account-demo" };
    }),
    release: vi.fn(() => {
      order.push("release");
    }),
    preflight: vi.fn(() => {
      order.push("preflight");
    }),
    modelPolicy: () => ({ pair: undefined, layer: undefined }),
    admit: vi.fn(async () => {
      order.push("admit");
    }),
    attest: vi.fn(() => {
      order.push("attest");
    }),
    reject: vi.fn(() => {
      order.push("reject");
    }),
    forget: vi.fn(() => {
      order.push("forget");
    }),
  };
  return {
    options,
    ctx,
    cwd,
    order,
    create,
    dispose,
    attach,
    detach,
    original,
    agents,
    membership,
  };
}

describe("native transactional QA session creation", () => {
  it("preserves native preset/default behavior without synthetic model selection and removes the temporary listener", async () => {
    const t = world();
    const id = await createQaSession(t.options);
    expect(t.create).toHaveBeenCalledWith({
      sessionId: id,
      cwd: t.cwd,
      agentPreset: "qa-preset",
    });
    expect(t.attach).toHaveBeenCalledWith(id);
    expect(t.ctx.sessionController.selectModel).not.toHaveBeenCalled();
    expect(t.order).toEqual([
      "reserve",
      "preflight",
      "native-create",
      "attach",
      "admit",
      "attest",
    ]);
    expect(t.dispose).not.toHaveBeenCalled();
    expect(t.options.release).not.toHaveBeenCalled();
    await t.ctx.serial("agent/created", {
      agent: { session: { id } } as never,
      source: "startup",
    });
    expect(t.options.admit).toHaveBeenCalledOnce();
  });
  it("compensates a policy failure only after native rollback, detaches membership, and preserves its original cause", async () => {
    const t = world();
    t.options.admit = async () => {
      throw t.original;
    };
    await expect(createQaSession(t.options)).rejects.toMatchObject({
      cause: t.original,
    });
    const id = t.create.mock.calls[0]![0].sessionId;
    expect(t.options.sessionFiles.erase).toHaveBeenCalledWith([id]);
    expect(t.options.release).toHaveBeenCalledWith("account-demo", id);
    expect(t.options.forget).toHaveBeenCalledExactlyOnceWith(id);
    expect(t.order.slice(-6)).toEqual([
      "dispose",
      "reject",
      "detach",
      "erase",
      "release",
      "forget",
    ]);
    expect(t.membership.size).toBe(0);
    await expect(
      t.ctx.serial("agent/created", {
        agent: { session: { id } } as never,
        source: "startup",
      }),
    ).resolves.toBeUndefined();
  });
  it.each(["dispose", "detach", "erase", "unconfirmed"] as const)(
    "retains ownership and refusal when %s cannot confirm cleanup",
    async (stage) => {
      const t = world();
      t.options.admit = async () => {
        throw t.original;
      };
      if (stage === "dispose")
        t.dispose.mockRejectedValue(new Error("writer unavailable"));
      else if (stage === "detach")
        t.detach.mockRejectedValue(new Error("workspace unavailable"));
      else if (stage === "erase")
        vi.mocked(t.options.sessionFiles.erase).mockRejectedValue(
          new Error("disk unavailable"),
        );
      else
        vi.mocked(t.options.sessionFiles.erase).mockResolvedValue({
          removed: [],
          absent: [],
        });
      await expect(createQaSession(t.options)).rejects.toMatchObject({
        cause: t.original,
      });
      expect(t.options.reject).toHaveBeenCalledOnce();
      expect(t.options.release).not.toHaveBeenCalled();
      expect(t.options.forget).not.toHaveBeenCalled();
      if (stage === "dispose" || stage === "detach")
        expect(t.options.sessionFiles.erase).not.toHaveBeenCalled();
    },
  );
  it("checks policy catalog and deployment before materializing durable state", async () => {
    const t = world();
    t.options.modelPolicy = () => ({
      pair: { provider: "missing", model: "missing" },
      layer: "account",
    });
    await expect(createQaSession(t.options)).rejects.toThrow(
      "Unable to create",
    );
    expect(t.create).not.toHaveBeenCalled();
    expect(t.options.release).toHaveBeenCalledOnce();
    expect(t.options.sessionFiles.erase).not.toHaveBeenCalled();
    expect(t.options.forget).toHaveBeenCalledOnce();
    expect(t.order.slice(-2)).toEqual(["release", "forget"]);
  });

  it("retains the refusal if ownership release fails after confirmed resource cleanup", async () => {
    const t = world();
    t.options.admit = async () => {
      throw t.original;
    };
    vi.mocked(t.options.release).mockImplementation(() => {
      throw new Error("ownership store unavailable");
    });
    await expect(createQaSession(t.options)).rejects.toMatchObject({
      cause: t.original,
    });
    expect(t.options.sessionFiles.erase).toHaveBeenCalledOnce();
    expect(t.options.forget).not.toHaveBeenCalled();
  });
  it("ignores concurrent publication of another identity and selects only the requested policy inside creation", async () => {
    const t = world();
    t.options.modelPolicy = () => ({
      pair: { provider: "demo", model: "role-model" },
      layer: "account",
    });
    const nativeCreate = t.create.getMockImplementation()!;
    t.create.mockImplementation(async (request) => {
      await t.ctx.serial("agent/created", {
        agent: { session: { id: "unrelated" } } as never,
        source: "startup",
      });
      return nativeCreate(request);
    });
    const id = await createQaSession(t.options);
    expect(t.ctx.sessionController.selectModel).toHaveBeenCalledExactlyOnceWith(
      { sessionId: id, provider: "demo", model: "role-model" },
    );
    expect(t.options.admit).toHaveBeenCalledExactlyOnceWith(id);
    expect(t.order.indexOf("select")).toBeLessThan(t.order.indexOf("admit"));
  });
});
