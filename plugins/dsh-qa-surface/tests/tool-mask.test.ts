import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createScope } from "@deepseek-ai/dsh-scope";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import { describe, expect, it } from "vitest";
import { installInheritableMask } from "../src/enforcement/tool-mask.js";

function tool(name: string) {
  return defineTool({
    name,
    description: `${name} tool`,
    parameters: {},
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }],
    },
    execute: async () => `${name} ran`,
  });
}

async function agentRegistry(options: {
  readonly global: readonly string[];
  readonly local?: readonly string[];
}) {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime);
  for (const name of options.global) ctx.tools.register(tool(name));
  const agent = {
    id: "agent-a",
    session: { id: "session-a", header: { cwd: process.cwd() } },
  } as unknown as Agent;
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        const scope = createScope(inner, agent);
        (agent as unknown as { ctx: Context }).ctx = scope.ctx;
        for (const name of options.local ?? []) {
          scope.ctx.tools.register(tool(name));
        }
      },
      { inject: ["tools"] },
    ),
  );
  return { ctx, agent };
}

/** A registry stub that refuses exactly the names the harness refuses. */
function refusingRegistry(refused: readonly string[]) {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    restrict: (filter: { readonly allow: readonly string[] }) => {
      calls.push([...filter.allow]);
      const unknown = filter.allow.filter((name) => refused.includes(name));
      if (unknown.length > 0) {
        throw new Error(
          `tools.restrict() names unknown global tool${unknown.length > 1 ? "s" : ""} ${unknown
            .map((name) => `"${name}"`)
            .join(", ")}; known global tools: glob, grep`,
        );
      }
      return () => undefined;
    },
  };
}

describe("installInheritableMask", () => {
  it("masks the inherited names against the live registry", async () => {
    const { agent } = await agentRegistry({
      global: ["glob", "edit"],
      local: ["qa_tools_selfcheck"],
    });
    const tools = agent.ctx.tools as unknown as {
      get(name: string, scope?: Agent): unknown;
    };
    // The catalog's tool rides on the agent itself: no mask may name it, and
    // naming it used to make the registry refuse the whole call.
    const mask = installInheritableMask(
      agent.ctx.tools,
      ["glob", "qa_tools_selfcheck"],
      new Set(["qa_tools_selfcheck"]),
    );

    expect(mask.refused).toEqual([]);
    expect(tools.get("glob", agent)).toBeDefined();
    expect(tools.get("qa_tools_selfcheck", agent)).toBeDefined();
    // Everything the mask does not admit is gone from the model surface.
    expect(tools.get("edit", agent)).toBeUndefined();
    mask.dispose();
    expect(tools.get("edit", agent)).toBeDefined();
  });

  it("keeps a name the global layer does not hold", () => {
    // A preset's own tool rows are inherited from an ancestor scope, so they
    // are absent from the global view and still perfectly nameable in a mask.
    const registry = refusingRegistry([]);
    const mask = installInheritableMask(
      registry,
      ["glob", "read", "qa_tools_selfcheck"],
      new Set(["qa_tools_selfcheck"]),
    );

    expect(registry.calls).toEqual([["glob", "read"]]);
    expect(mask.refused).toEqual([]);
  });

  it("gives up a name the registry refuses instead of failing the call", () => {
    const registry = refusingRegistry(["ghost_tool"]);
    const mask = installInheritableMask(
      registry,
      ["glob", "ghost_tool", "read"],
      new Set(),
    );

    expect(registry.calls).toEqual([
      ["glob", "ghost_tool", "read"],
      ["glob", "read"],
    ]);
    expect(mask.refused).toEqual(["ghost_tool"]);
  });

  it("stops when the refusal names nothing the mask carries", () => {
    const registry = {
      calls: [] as (readonly string[])[],
      restrict: (filter: { readonly allow: readonly string[] }) => {
        registry.calls.push([...filter.allow]);
        throw new Error("tools.restrict({}) is a no-op");
      },
    };
    const mask = installInheritableMask(registry, ["glob"], new Set());

    expect(registry.calls).toEqual([["glob"]]);
    expect(mask.refused).toEqual(["glob"]);
    // No mask was installed, so lifting it is a no-op rather than a stale call.
    expect(() => mask.dispose()).not.toThrow();
  });

  it("installs nothing when every name belongs to the agent itself", () => {
    const registry = refusingRegistry([]);
    const mask = installInheritableMask(
      registry,
      ["qa_tools_selfcheck"],
      new Set(["qa_tools_selfcheck"]),
    );

    expect(registry.calls).toEqual([]);
    expect(mask.refused).toEqual([]);
  });
});
