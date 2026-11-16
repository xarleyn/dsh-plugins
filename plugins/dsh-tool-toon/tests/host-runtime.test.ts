import * as NativeExecutor from "@deepseek-ai/dsh-tool-executor-native";
import { Context } from "@deepseek-ai/cordis";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { expect, it } from "vitest";
import * as plugin from "../src/index.js";

it("formats through the real Host registry and unregisters on disposal", async () => {
  const ctx = new Context();
  ctx.provide("systemPrompt", { tools: () => () => {} });
  const runtime = await ctx.plugin(ToolRuntime);
  await ctx.plugin(NativeExecutor);
  const fiber = await ctx.plugin(plugin);
  const value = {
    items: Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `Demo field ${i}`,
      custom: true,
      searchable: true,
    })),
  };
  ctx.tools.register({
    name: "synthetic_fields",
    description: "Synthetic field catalogue",
    parameters: { type: "object", properties: {} },
    output: {
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    execute: async () => value,
  });
  const call = () =>
    ctx.tools
      .execute({
        calls: [
          {
            type: "tool-call",
            id: "synthetic-call" as Parameters<
              typeof ctx.tools.execute
            >[0]["calls"][number]["id"],
            name: "synthetic_fields",
            arguments: JSON.stringify({}),
          },
        ],
        signal: new AbortController().signal,
      })
      .then((batch) => batch.results[0]!.result);
  try {
    const result = await call();
    expect(result.isError).toBe(false);
    expect(result.value).toEqual(value);
    expect(result.content).toMatchObject([
      { type: "text", text: expect.stringMatching(/^```toon/u) },
    ]);
    await fiber.dispose();
    expect((await call()).content).toEqual([
      { type: "text", text: JSON.stringify(value) },
    ]);
  } finally {
    await fiber.dispose();
    await runtime.dispose();
    await ctx.fiber.dispose();
  }
});
