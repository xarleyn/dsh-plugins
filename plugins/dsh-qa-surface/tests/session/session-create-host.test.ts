import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import SessionStore, { SessionId } from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { createQaSession } from "../../src/session-create.js";

it("lets the installed Host factory unwind scope and registries before failed QA creation erases storage", async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjectionRegistry);
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(AgentLoop, { agents: [] });
    const order: string[] = [];
    let id = "";
    // Only the native remote façade is synthetic: the installed factory owns
    // session construction, publication, maintenance, scope and rollback.
    ctx.provide("sessionController", {
      create: async (request: { sessionId: string; cwd: string }) => {
        id = request.sessionId;
        await ctx.agents.create({
          sessionId: SessionId(id),
          meta: { cwd: request.cwd },
          setup: async (agentCtx) => {
            agentCtx.effect(() => () => {
              order.push("scope-disposed");
            });
          },
        });
        return { sessionId: id };
      },
    } as never);
    const original = new Error("synthetic admission veto");
    const erase = vi.fn(async (ids: readonly string[]) => {
      expect(ctx.agents.get(SessionId(id))).toBeUndefined();
      expect(ctx.sessions.get(SessionId(id))).toBeUndefined();
      expect(order).toContain("scope-disposed");
      order.push("erase");
      return { removed: ids, absent: [] };
    });
    await expect(
      createQaSession({
        ctx,
        config: resolveConfig({}),
        logger: { error: vi.fn() } as never,
        sessionFiles: { erase },
        reserve: () => ({ id: "account-demo" }),
        release: () => {
          order.push("release");
        },
        modelPolicy: () => ({ pair: undefined, layer: undefined }),
        preflight: () => {},
        admit: async (sessionId) => {
          expect(ctx.agents.get(SessionId(sessionId))).toBeDefined();
          expect(ctx.sessions.get(SessionId(sessionId))).toBeDefined();
          await Promise.resolve();
          throw original;
        },
        attest: () => {
          throw new Error("unreachable");
        },
        reject: () => {
          order.push("reject");
        },
        forget: () => {
          order.push("forget");
        },
      }),
    ).rejects.toMatchObject({ cause: original });
    expect(erase).toHaveBeenCalledExactlyOnceWith([id]);
    expect(order).toEqual([
      "scope-disposed",
      "reject",
      "erase",
      "release",
      "forget",
    ]);
  } finally {
    await ctx.fiber.dispose();
  }
});
