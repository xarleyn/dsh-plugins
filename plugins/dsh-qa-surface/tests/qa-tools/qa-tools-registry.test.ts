import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createScope } from "@deepseek-ai/dsh-scope";
import type { Scope } from "@deepseek-ai/dsh-scope";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { describe, expect, it } from "vitest";
import { QaToolActivationManager } from "../../src/qa-tools/activation-manager.js";
import type { QaToolDescriptor } from "../../src/qa-tools/types.js";

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as PluginLogger;

function probe(name: string): QaToolDescriptor {
  return {
    definition: {
      name,
      description: `probe ${name}`,
      parameters: { type: "object", properties: {} },
      output: {
        schema: { type: "string" },
        render: () => [{ type: "text", text: name }],
      },
      execute: async () => name,
    },
  };
}

/** Mount the real registry with its system-prompt dependency on a fresh context. */
async function mount(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime);
  return ctx;
}

/** Mint a scope whose key doubles as the agent the manager registers for. */
async function mintAgent(
  ctx: Context,
  name: string,
): Promise<{ agent: Agent; scope: Scope }> {
  const key = {
    id: name as SessionId,
    session: { id: `${name}-session`, header: {} },
  } as unknown as Agent;
  let scope!: Scope;
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        scope = createScope(inner, key);
      },
      { inject: ["tools", "systemPrompt"] },
    ),
  );
  (key as unknown as { ctx: Context }).ctx = scope.ctx;
  return { agent: key, scope };
}

function schemaNames(ctx: Context, agent: Agent): string[] {
  return ctx.tools
    .schemas(agent)
    .map((schema) => schema.name)
    .sort();
}

describe("QA tools against the real tool registry", () => {
  it("keeps the catalog out of the schema view until activation", async () => {
    const ctx = await mount();
    const { agent } = await mintAgent(ctx, "a");
    const manager = new QaToolActivationManager({
      catalog: [probe("qa_probe")],
      catalogVersion: "1",
      logger: silentLogger,
    });
    ctx.tools.register(globalTool("read"));

    expect(schemaNames(ctx, agent)).toEqual(["read"]);
    expect(manager.activate(agent, "skill")).toEqual({
      status: "activated",
      count: 1,
    });
    expect(schemaNames(ctx, agent)).toEqual(["qa_probe", "read"]);
    // Activation is scoped: the global view and every other agent stay clean.
    expect(ctx.tools.schemas().map((schema) => schema.name)).toEqual(["read"]);
  });

  it("stays visible through an allow-list restriction of inherited tools", async () => {
    const ctx = await mount();
    const { agent, scope } = await mintAgent(ctx, "a");
    const manager = new QaToolActivationManager({
      catalog: [probe("qa_probe")],
      catalogVersion: "1",
      logger: silentLogger,
    });
    ctx.tools.register(globalTool("read"));
    ctx.tools.register(globalTool("bash"));
    // Exactly what the QA admission gate does for a configured allow-list.
    scope.ctx.tools.restrict({ allow: ["read"] });
    manager.activate(agent, "skill");

    expect(schemaNames(ctx, agent)).toEqual(["qa_probe", "read"]);
  });

  it("keeps two agents' surfaces independent and unwinds on disposal", async () => {
    const ctx = await mount();
    const a = await mintAgent(ctx, "a");
    const b = await mintAgent(ctx, "b");
    const manager = new QaToolActivationManager({
      catalog: [probe("qa_probe")],
      catalogVersion: "1",
      logger: silentLogger,
    });
    manager.activate(a.agent, "skill");
    expect(schemaNames(ctx, a.agent)).toEqual(["qa_probe"]);
    expect(schemaNames(ctx, b.agent)).toEqual([]);

    manager.disposeAgent(a.agent);
    expect(schemaNames(ctx, a.agent)).toEqual([]);
    expect(schemaNames(ctx, b.agent)).toEqual([]);

    manager.activate(b.agent, "skill");
    expect(schemaNames(ctx, b.agent)).toEqual(["qa_probe"]);
  });

  it("leaves no registration behind when the scope itself is disposed", async () => {
    const ctx = await mount();
    const { agent, scope } = await mintAgent(ctx, "a");
    const manager = new QaToolActivationManager({
      catalog: [probe("qa_probe")],
      catalogVersion: "1",
      logger: silentLogger,
    });
    manager.activate(agent, "skill");
    await scope.dispose();
    expect(ctx.tools.get("qa_probe", agent)).toBeUndefined();
  });
});

function globalTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    output: {
      schema: { type: "string" },
      render: () => [{ type: "text", text: name }],
    },
    execute: async () => name,
  };
}
