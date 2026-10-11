import { describe, expect, it, vi } from "vitest";

import { createMessage } from "@deepseek-ai/dsh-llm";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Usage,
} from "@earendil-works/pi-ai";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { toPiContext } from "../../src/upstream/context.js";

import { toStreamChunks } from "../../src/upstream/stream.js";

function usage(input = 0, output = 0, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistant(
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    usage: usage(),
    stopReason: "stop",
    timestamp: 0,
    ...overrides,
  };
}

async function* feed(
  ...events: AssistantMessageEvent[]
): AsyncGenerator<AssistantMessageEvent> {
  for (const event of events) yield event;
}

async function collect(
  stream: AsyncIterable<StreamChunk>,
): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe("toStreamChunks", () => {
  it.each([
    ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
    ["claude-fable-5", "claude-opus-5"],
    ["claude-opus-5", "claude-opus-5"],
  ])(
    "replays Anthropic request %s with native response model %s",
    async (requestedModel, returnedModel) => {
      const native = assistant({
        api: "anthropic-messages",
        provider: "anthropic",
        model: returnedModel,
        providerThinkingLevel: "high",
        content: [
          { type: "thinking", thinking: "reason", thinkingSignature: "signed" },
        ],
      });
      const chunks = await collect(
        toStreamChunks(
          feed({ type: "done", reason: "stop", message: native }),
          undefined,
          undefined,
          requestedModel,
        ),
      );
      const finish = chunks.find((chunk) => chunk.type === "finish");
      const replayState: unknown = JSON.parse(
        JSON.stringify(finish?.replayState),
      );
      expect(replayState).toMatchObject({
        response: { model: requestedModel },
      });
      if (requestedModel !== returnedModel) {
        expect(replayState).toMatchObject({
          response: { responseModel: returnedModel },
        });
      }
      const onDegrade = vi.fn();
      const context = toPiContext(
        {
          provider: "anthropic",
          model: requestedModel,
          messages: [
            createMessage({
              role: "assistant",
              content: [{ type: "reasoning", text: "reason" }],
              source: {
                kind: "model",
                provider: "anthropic",
                model: requestedModel,
                replayState,
              },
            }),
          ],
        },
        undefined,
        onDegrade,
      );
      expect(onDegrade).not.toHaveBeenCalled();
      expect(context.messages[0]).toMatchObject({
        api: "anthropic-messages",
        model: returnedModel,
        providerThinkingLevel: "high",
        content: native.content,
      });
      const catalog = getBuiltinModels("anthropic");
      const requested = catalog.find((model) => model.id === requestedModel);
      const returned = catalog.find((model) => model.id === returnedModel);
      if (requested === undefined || returned === undefined)
        throw new Error("missing Anthropic catalog model");
      expect(transformMessages(context.messages, returned)[0]).toMatchObject({
        content: native.content,
      });
      expect(transformMessages(context.messages, requested)[0]).toMatchObject({
        content:
          requestedModel === returnedModel
            ? native.content
            : [{ type: "text", text: "reason" }],
      });
    },
  );

  const partialWithToolCall = assistant({
    content: [{ type: "toolCall", id: "call-1", name: "f", arguments: {} }],
  });

  it("maps text events to text blocks", async () => {
    const done = assistant({
      content: [{ type: "text", text: "hi" }],
      usage: usage(3, 2),
    });
    const chunks = await collect(
      toStreamChunks(
        feed(
          { type: "start", partial: assistant() },
          { type: "text_start", contentIndex: 0, partial: assistant() },
          {
            type: "text_delta",
            contentIndex: 0,
            delta: "hi",
            partial: assistant(),
          },
          {
            type: "text_end",
            contentIndex: 0,
            content: "hi",
            partial: assistant(),
          },
          { type: "done", reason: "stop", message: done },
        ),
      ),
    );
    expect(chunks).toEqual([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "hi" },
      { type: "block-end", index: 0, block: { type: "text", text: "hi" } },
      {
        type: "usage",
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      },
      {
        type: "finish",
        reason: { kind: "stop" },
        replayState: {
          response: {
            kind: "pi-ai",
            version: 2,
            api: "openai-completions",
            provider: "deepseek",
            model: "deepseek-v4-flash",
            stopReason: "stop",
          },
          blocks: [{ type: "text" }],
        },
      },
    ]);
  });

  it("maps thinking events to reasoning blocks", async () => {
    const chunks = await collect(
      toStreamChunks(
        feed(
          { type: "thinking_start", contentIndex: 0, partial: assistant() },
          {
            type: "thinking_delta",
            contentIndex: 0,
            delta: "mull",
            partial: assistant(),
          },
          {
            type: "thinking_end",
            contentIndex: 0,
            content: "mull",
            partial: assistant(),
          },
          { type: "done", reason: "stop", message: assistant() },
        ),
      ),
    );
    expect(chunks.slice(0, 3)).toEqual([
      { type: "block-start", index: 0, blockType: "reasoning" },
      { type: "reasoning-delta", index: 0, text: "mull" },
      {
        type: "block-end",
        index: 0,
        block: { type: "reasoning", text: "mull" },
      },
    ]);
  });

  it("maps tool-call events, re-stringifying parsed arguments", async () => {
    const chunks = await collect(
      toStreamChunks(
        feed(
          {
            type: "toolcall_start",
            contentIndex: 0,
            partial: partialWithToolCall,
          },
          {
            type: "toolcall_delta",
            contentIndex: 0,
            delta: '{"a"',
            partial: partialWithToolCall,
          },
          {
            type: "toolcall_delta",
            contentIndex: 0,
            delta: ":1}",
            partial: partialWithToolCall,
          },
          {
            type: "toolcall_end",
            contentIndex: 0,
            toolCall: {
              type: "toolCall",
              id: "call-1",
              name: "f",
              arguments: { a: 1 },
            },
            partial: partialWithToolCall,
          },
          {
            type: "done",
            reason: "toolUse",
            message: assistant({
              content: partialWithToolCall.content,
              stopReason: "toolUse",
            }),
          },
        ),
      ),
    );
    expect(chunks).toEqual([
      { type: "block-start", index: 0, blockType: "tool-call" },
      {
        type: "tool-call-delta",
        index: 0,
        id: "call-1",
        name: "f",
        argumentsDelta: '{"a"',
      },
      {
        type: "tool-call-delta",
        index: 0,
        id: "call-1",
        name: "f",
        argumentsDelta: ":1}",
      },
      {
        type: "block-end",
        index: 0,
        block: {
          type: "tool-call",
          id: "call-1",
          name: "f",
          arguments: '{"a":1}',
        },
      },
      {
        type: "usage",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
      {
        type: "finish",
        reason: { kind: "tool-calls" },
        replayState: {
          response: {
            kind: "pi-ai",
            version: 2,
            api: "openai-completions",
            provider: "deepseek",
            model: "deepseek-v4-flash",
            stopReason: "toolUse",
          },
          blocks: [{ type: "tool-call" }],
        },
      },
    ]);
  });

  it("tolerates toolcall_start with a missing partial entry", async () => {
    const chunks = await collect(
      toStreamChunks(
        feed(
          { type: "toolcall_start", contentIndex: 0, partial: assistant() },
          {
            type: "toolcall_delta",
            contentIndex: 0,
            delta: "{}",
            partial: assistant(),
          },
          { type: "done", reason: "stop", message: assistant() },
        ),
      ),
    );
    expect(chunks[1]).toEqual({
      type: "tool-call-delta",
      index: 0,
      id: "",
      argumentsDelta: "{}",
    });
  });

  it("maps error events to error finish chunks (in-stream error style)", async () => {
    const error = assistant({
      stopReason: "error",
      errorMessage: "boom",
      usage: usage(1, 0),
    });
    const chunks = await collect(
      toStreamChunks(feed({ type: "error", reason: "error", error })),
    );
    expect(chunks).toEqual([
      {
        type: "usage",
        usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
      },
      {
        type: "finish",
        reason: {
          kind: "error",
          failure: { message: "boom", code: "PI_AI_ERROR" },
        },
      },
    ]);
  });

  it("maps aborted error events to aborted finish", async () => {
    const error = assistant({ stopReason: "aborted" });
    const chunks = await collect(
      toStreamChunks(feed({ type: "error", reason: "aborted", error })),
    );
    expect(chunks.at(-1)).toEqual({
      type: "finish",
      reason: {
        kind: "aborted",
        failure: { message: "pi-ai stream aborted", code: "ABORTED" },
      },
    });
  });

  it("rejects a stream that ends without done or error", async () => {
    await expect(
      collect(toStreamChunks(feed({ type: "start", partial: assistant() }))),
    ).rejects.toThrow(/without done\/error/);
  });

  it("preserves an unknown SDK iterator Error exactly", async () => {
    const original = Object.assign(new Error("SDK transport exploded"), {
      code: "ECONNRESET",
    });
    async function* failedSdkStream(): AsyncGenerator<AssistantMessageEvent> {
      throw original;
    }

    await expect(collect(toStreamChunks(failedSdkStream()))).rejects.toBe(
      original,
    );
  });
});
