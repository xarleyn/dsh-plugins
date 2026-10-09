import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { createScope, type Scope } from "@deepseek-ai/dsh-scope";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { QaCapabilityCatalog } from "../../src/access/capability-catalog.js";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";

describe("native agent scope catalog", () => {
  it("retains preset capabilities while a session mask hides tools awaiting skill activation", async () => {
    const root = new Context();
    await root.plugin(SystemPrompt, {});
    await root.plugin(ToolRuntime);
    const presetKey = {};
    const agent = { session: { header: { cwd: "/demo" } } } as unknown as Agent;
    let preset!: Scope;
    let scope!: Scope;
    await root.plugin(Object.assign((inner: Context) => {
      preset = createScope(inner, presetKey);
      scope = createScope(inner, agent, { parent: presetKey });
      Object.assign(agent, { ctx: scope.ctx });
      for (const name of ["read", "web_search"]) {
        preset.ctx.tools.register(defineTool({
          name, description: name, parameters: {},
          output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: String(value) }] },
          execute: async () => name,
        }));
      }
    }, { inject: ["tools"] }));
    const catalog = new QaCapabilityCatalog(root);
    try {
      expect([...((await catalog.snapshot(agent)).toolIds)]).toEqual(["read", "web_search"]);
      scope.ctx.tools.restrict({ allow: ["read"] });
      expect(root.tools.schemas(agent).map(({ name }) => name)).toEqual(["read"]);
      expect([...((await catalog.snapshot(agent)).toolIds)]).toEqual(["read", "web_search"]);
    } finally {
      await scope.dispose();
      await preset.dispose();
    }
  });
  it("reads tools and skills through the opaque context scope, which differs from the Agent object", async () => {
    const root = new Context();
    const key = {};
    const scope = createScope(root, key);
    const agent = {
      ctx: scope.ctx,
      session: { header: { cwd: "/demo" } },
    } as unknown as Agent;
    const ctx = {
      tools: {
        schemas: (view?: unknown) =>
          view === key ? [{ name: "ask_user_question" }, { name: "read" }] : [],
      },
      get: () => ({
        snapshot: async (options: { scope?: unknown }) => ({
          skills:
            options.scope === key
              ? [
                  {
                    name: "search-docs",
                    description: "Read product evidence",
                    provider: "filesystem",
                    source: "custom",
                    invocation: { modelInvocable: true, userInvocable: true },
                  },
                ]
              : [],
          complete: true,
        }),
      }),
    } as unknown as Context;
    try {
      const view = await new QaCapabilityCatalog(ctx).snapshot(agent);
      expect([...view.toolIds]).toEqual(["ask_user_question", "read"]);
      expect([...view.skillIds]).toEqual(["search-docs"]);
      const unscoped = await new QaCapabilityCatalog(ctx).snapshot();
      expect([...unscoped.toolIds]).toEqual([]);
      expect([...unscoped.skillIds]).toEqual([]);
    } finally {
      await scope.dispose();
    }
  });
});
