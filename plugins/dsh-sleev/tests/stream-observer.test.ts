import { describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import { observeStream } from "../src/host/stream-observer.js";

async function* chunks(
  values: readonly StreamChunk[],
): AsyncIterable<StreamChunk> {
  yield* values;
}

describe("stream observer", () => {
  it("passes chunks through by identity and reports success", async () => {
    const input: StreamChunk[] = [
      { type: "usage", usage: { inputTokens: 5, outputTokens: 2 } },
      { type: "finish", reason: { kind: "stop" } },
    ];
    const observation = { observeUsage: vi.fn(), finish: vi.fn() };
    const output: StreamChunk[] = [];
    for await (const chunk of observeStream(chunks(input), observation)) {
      output.push(chunk);
    }
    expect(output[0]).toBe(input[0]);
    expect(output[1]).toBe(input[1]);
    expect(observation.observeUsage).toHaveBeenCalledWith(
      (input[0] as Extract<StreamChunk, { type: "usage" }>).usage,
    );
    expect(observation.finish).toHaveBeenCalledOnce();
    expect(observation.finish).toHaveBeenCalledWith({ kind: "success" });
  });

  it("records thrown downstream errors and rethrows them", async () => {
    const failure = Object.assign(new Error("wire failed"), { code: "WIRE" });
    async function* broken(): AsyncIterable<StreamChunk> {
      throw failure;
    }
    const observation = { observeUsage: vi.fn(), finish: vi.fn() };
    await expect(async () => {
      for await (const _chunk of observeStream(broken(), observation)) {
        // no chunks
      }
    }).rejects.toBe(failure);
    expect(observation.finish).toHaveBeenCalledWith({
      kind: "error",
      code: "WIRE",
    });
  });

  it("marks a stream without a terminal finish chunk as incomplete", async () => {
    const observation = { observeUsage: vi.fn(), finish: vi.fn() };
    for await (const _chunk of observeStream(chunks([]), observation)) {
      // no chunks
    }
    expect(observation.finish).toHaveBeenCalledWith({
      kind: "error",
      code: "STREAM_INCOMPLETE",
    });
  });
});
