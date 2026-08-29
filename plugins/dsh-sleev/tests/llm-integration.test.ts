import { Context } from "@deepseek-ai/cordis";
import {
  LlmAdapter,
  LlmRuntime,
  type GenerateOptions,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import { describe, expect, it } from "vitest";
import SleevIntegrationService from "../src/index.js";

const SCRIPT: readonly StreamChunk[] = [
  { type: "block-start", index: 0, blockType: "text" },
  { type: "text-delta", index: 0, text: "hello" },
  {
    type: "block-end",
    index: 0,
    block: { type: "text", text: "hello" },
  },
  {
    type: "usage",
    usage: {
      inputTokens: 11,
      outputTokens: 2,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
    },
  },
  { type: "finish", reason: { kind: "stop" } },
];

class ScriptedAdapter extends LlmAdapter {
  calls = 0;

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1;
    yield* SCRIPT;
  }
}

async function drain(
  stream: AsyncIterable<StreamChunk>,
): Promise<StreamChunk[]> {
  const output: StreamChunk[] = [];
  for await (const chunk of stream) output.push(chunk);
  return output;
}

describe("real DSH llm waterfall integration", () => {
  it("observes an optimized route without changing or duplicating chunks", async () => {
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SleevIntegrationService, {
      routes: ["sleev-test"],
      routePrefixes: [],
      logLevel: "off",
    });
    const adapter = new ScriptedAdapter();
    ctx.llm.registerAdapter(["sleev-test"], adapter);

    const output = await drain(
      ctx.llm.stream({
        provider: "sleev-test",
        model: "model-a",
        messages: [],
      }),
    );

    expect(adapter.calls).toBe(1);
    expect(output).toHaveLength(SCRIPT.length);
    output.forEach((chunk, index) => expect(chunk).toBe(SCRIPT[index]));
    expect(ctx.sleev.listRecentCalls()).toMatchObject([
      {
        provider: "sleev-test",
        model: "model-a",
        kind: "one-shot",
        providerUsage: {
          inputTokens: 11,
          outputTokens: 2,
          cacheReadTokens: 5,
          cacheWriteTokens: 1,
        },
        derived: { effectiveInputTokens: 17 },
        result: { kind: "success" },
      },
    ]);

    await ctx.fiber.dispose();
  });

  it("bypasses direct routes completely", async () => {
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SleevIntegrationService, { logLevel: "off" });
    const adapter = new ScriptedAdapter();
    ctx.llm.registerAdapter(["direct"], adapter);

    expect(
      await drain(
        ctx.llm.stream({
          provider: "direct",
          model: "model-a",
          messages: [],
        }),
      ),
    ).toEqual(SCRIPT);
    expect(ctx.sleev.listRecentCalls()).toEqual([]);

    await ctx.fiber.dispose();
  });
});
