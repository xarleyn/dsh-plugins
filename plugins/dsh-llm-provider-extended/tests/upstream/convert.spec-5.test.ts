import { describe, expect, it } from "vitest";

import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Usage,
} from "@earendil-works/pi-ai";

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

describe("toStreamChunks defensive branches", () => {
  it("tolerates a toolcall_delta with no preceding toolcall_start", async () => {
    const chunks = await collect(
      toStreamChunks(
        feed(
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
    expect(chunks[0]).toEqual({
      type: "tool-call-delta",
      index: 0,
      id: "",
      argumentsDelta: "{}",
    });
  });
});
