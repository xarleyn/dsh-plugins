import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createScope } from "@deepseek-ai/dsh-scope";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { type ToolDefinition } from "@deepseek-ai/dsh-tools";
import { describe, expect, it } from "vitest";
import { isDelegatedStructuredResult } from "../../src/enforcement/structured-result.js";
import { qaCeilingDenial } from "../../src/lockdown-policy.js";

function captureTool(execute: ToolDefinition["execute"]): ToolDefinition {
  return {
    name: "structured_output",
    description: "Capture the child result",
    parameters: { type: "object", properties: {} },
    output: {
      schema: {
        type: "object", properties: { recorded: { type: "boolean", const: true } },
        required: ["recorded"], additionalProperties: false,
      },
      render: () => [{ type: "text", text: "Recorded" }],
    },
    execute,
  };
}

async function setup() {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime);
  const root = { session: { header: {} } } as unknown as Agent;
  const child = {
    session: { header: { origin: "subagent", parentSession: "root", delegationDepth: 1 } },
  } as unknown as Agent;
  await ctx.plugin(Object.assign((inner: Context) => {
    (root as unknown as { ctx: Context }).ctx = createScope(inner, root).ctx;
    (child as unknown as { ctx: Context }).ctx = createScope(inner, child, { parent: root }).ctx;
  }, { inject: ["tools"] }));
  ctx.tools.guard((execution) =>
    isDelegatedStructuredResult(ctx, execution.agent, execution.name)
      ? undefined : qaCeilingDenial(new Set(), execution.name));
  const call = (agent: Agent, name = "structured_output") => ctx.tools.execute({
    callId: "capture" as never, name, arguments: {}, agent,
    signal: new AbortController().signal,
  });
  return { ctx, root, child, call };
}

describe("delegated structured result channel through the native tool pipeline", () => {
  it("admits child-owned capture and preserves the denial for other tools", async () => {
    const { child, call } = await setup();
    let captured = false;
    const definition = captureTool(async () => { captured = true; return { recorded: true }; });
    child.ctx.tools.register(definition);
    child.ctx.tools.register({ ...definition, name: "unexpected_tool" });
    expect((await call(child)).isError).toBe(false);
    expect(captured).toBe(true);
    expect((await call(child, "unexpected_tool")).isError).toBe(true);
  });

  it("refuses the channel on the primary agent, even with the expected schema", async () => {
    const { root, call } = await setup();
    let dispatched = false;
    root.ctx.tools.register(captureTool(async () => { dispatched = true; return { recorded: true }; }));
    expect((await call(root)).isError).toBe(true);
    expect(dispatched).toBe(false);
  });

  it("refuses global and ancestor registrations with the same name", async () => {
    const { ctx, root, child, call } = await setup();
    let dispatched = false;
    const definition = captureTool(async () => { dispatched = true; return { recorded: true }; });
    const removeGlobal = ctx.tools.register(definition);
    expect((await call(child)).isError).toBe(true);
    removeGlobal();
    root.ctx.tools.register(definition);
    expect((await call(child)).isError).toBe(true);
    expect(dispatched).toBe(false);
  });

  it("refuses a child tool with a different result contract", async () => {
    const { child, call } = await setup();
    const definition = captureTool(async () => ({ recorded: true }));
    child.ctx.tools.register({ ...definition, output: { ...definition.output!, schema: { type: "string" } } });
    expect((await call(child)).isError).toBe(true);
  });
});
