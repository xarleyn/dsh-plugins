import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import { createScope, type Scope } from "@deepseek-ai/dsh-scope";
import ToolsService, { type ToolDefinition } from "@deepseek-ai/dsh-tools";
import {
  executeToolBatch,
  ToolExecutionPipeline,
} from "@deepseek-ai/dsh-tools/pipeline";
import { guardReviewDelegation } from "@yadsh/dsh-plugin-kit";
import { expect, it, vi } from "vitest";

it("refuses an aliased background worker through the real Host pipeline, then accepts structured output", async () => {
  const ctx = new Context();
  ctx.provide("systemPrompt", { tools: () => () => {} });
  new ToolsService(ctx);
  const reviewer = { id: "review-child" } as Agent;
  const primary = { id: "primary" } as Agent;
  let scope!: Scope;
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        scope = createScope(inner, reviewer);
      },
      { inject: ["tools"] },
    ),
  );
  const startChild = vi.fn(async () => ({
    kind: "activation",
    name: "worker",
  }));
  const worker: ToolDefinition = {
    name: "verify_source",
    description: "Start a verification worker",
    parameters: { type: "object", properties: {} },
    output: {
      schema: {
        type: "object",
        properties: {
          kind: { type: "string", const: "activation" },
          name: { type: "string" },
        },
      },
      render: () => [{ type: "text", text: "started worker" }],
    },
    execute: startChild,
  };
  ctx.tools.register(worker);
  ctx.tools.register({
    ...worker,
    name: "structured_output",
    output: {
      schema: { type: "string" },
      render: () => [{ type: "text", text: "captured" }],
    },
    execute: async () => "captured",
  });
  const run = async (name: string, agent: Agent) => {
    const result = await executeToolBatch(
      {
        calls: [
          {
            type: "tool-call",
            id: ToolCallId("call-1"),
            name,
            arguments: "{}",
          },
        ],
        signal: new AbortController().signal,
        agent,
      },
      new ToolExecutionPipeline(ctx),
      () => 1,
    );
    return result.results[0]!.result;
  };
  try {
    guardReviewDelegation(scope.ctx.tools, reviewer);
    // Even a later policy's allow decision cannot undo this review guard.
    scope.ctx.on("tools/pre-execute", async () => ({ kind: "allow" }));
    const denied = await run(worker.name, reviewer);
    expect(denied.isError).toBe(true);
    expect(denied.content).toEqual([
      { type: "text", text: expect.stringContaining("cannot delegate") },
    ]);
    expect(startChild).not.toHaveBeenCalled();
    expect((await run("structured_output", reviewer)).isError).toBe(false);
    expect((await run(worker.name, primary)).isError).toBe(false);
    expect(startChild).toHaveBeenCalledOnce();
    await scope.dispose();
    expect((await run(worker.name, reviewer)).isError).toBe(false);
    expect(startChild).toHaveBeenCalledTimes(2);
  } finally {
    await scope.dispose();
  }
});
