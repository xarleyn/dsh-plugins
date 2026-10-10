import { afterEach, describe, expect, it } from "vitest";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { ExtendedAdapter } from "../src/adapter.js";
import {
  Config,
  resolveProfiles,
  type Options,
} from "../src/upstream/config.js";
import { generationPayload, validateGeneration } from "../src/generation.js";
import { memoryAuth } from "./upstream/auth-double.js";
import {
  closeMockServers,
  mockServer,
  textEvents,
} from "./upstream/mock-server.js";

afterEach(closeMockServers);
async function collect(
  stream: AsyncIterable<StreamChunk>,
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
const input: GenerateOptions = {
  provider: "demo",
  model: "m",
  messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
};

describe("generation defaults", () => {
  it("validates protocol restrictions, ranges and zero without changing request structure", () => {
    expect(
      validateGeneration(
        { temperature: 0, seed: 0, frequencyPenalty: 0 },
        "openai-completions",
      ),
    ).toEqual({ temperature: 0, seed: 0, frequencyPenalty: 0 });
    expect(() => validateGeneration({ seed: 1 }, "openai-responses")).toThrow(
      /unsupported/,
    );
    expect(() =>
      validateGeneration({ temperature: 2 }, "anthropic-messages"),
    ).toThrow(/at most 1/);
    expect(() =>
      validateGeneration({ topP: 0.8, temperature: 0.2 }, "anthropic-messages"),
    ).toThrow(/either/);
    expect(() =>
      validateGeneration({ topP: NaN }, "openai-completions"),
    ).toThrow(/finite/);
    expect(() =>
      validateGeneration({ topK: 1.5 }, "openai-completions"),
    ).toThrow(/range/);
    expect(() =>
      validateGeneration({ stop: [] }, "openai-completions"),
    ).toThrow(/one through four/);
    const body = {
      model: "m",
      messages: [{ role: "user", content: "Hello" }],
      tools: [{ type: "function" }],
    };
    expect(
      generationPayload(body, { topP: 0.7, seed: 0 }, "openai-completions"),
    ).toEqual({ ...body, top_p: 0.7, seed: 0 });
    expect(body).not.toHaveProperty("top_p");
    expect(
      generationPayload({}, { stop: ["done"] }, "anthropic-messages"),
    ).toEqual({ stop_sequences: ["done"] });
    expect(() =>
      generationPayload({ model: "m" }, { temperature: 0 }, "openai-responses"),
    ).toThrow(/does not support/);
  });
  it("keeps provider defaults when the schema materializes an empty model generation object", () => {
    const config = Config({
      providers: {
        demo: {
          api: "openai-completions",
          baseURL: "https://gateway.example.com/v1",
          models: [{ id: "m" }],
          generation: { temperature: 0, topP: 0.8 },
        },
      },
    });
    const profiles = resolveProfiles(
      config.providers.get() as Options["providers"],
    );
    expect(profiles.get("demo")?.modelGeneration.get("m")).toEqual({
      temperature: 0,
      topP: 0.8,
    });
  });
  it("sends provider/model/call precedence in the real HTTP body and keeps prepared calls frozen", async () => {
    const server = await mockServer([
      { events: textEvents },
      { events: textEvents },
      { events: textEvents },
    ]);
    const profiles = (temperature: number) =>
      resolveProfiles({
        demo: {
          api: "openai-completions",
          baseURL: server.url,
          models: [{ id: "m", generation: { topP: 0.7 } }],
          generation: {
            temperature,
            topP: 0.9,
            seed: 0,
            frequencyPenalty: 0,
            stop: ["DONE"],
          },
        },
      });
    let current = profiles(0.3);
    const adapter = new ExtendedAdapter({
      profiles: () => current,
      resolveApiKey: async () => "synthetic-key",
      auth: memoryAuth(),
    });
    const prepared = await adapter.prepareCall("demo", "m");
    current = profiles(1.1);
    await collect(prepared.stream(input));
    await collect(adapter.stream({ ...input, temperature: 0, stop: ["END"] }));
    await collect(adapter.stream(input));
    expect(server.requests[0]).toMatchObject({
      temperature: 0.3,
      top_p: 0.7,
      seed: 0,
      frequency_penalty: 0,
      stop: ["DONE"],
    });
    expect(server.requests[1]).toMatchObject({ temperature: 0, stop: ["END"] });
    expect(server.requests[2]).toMatchObject({ temperature: 1.1 });
    expect(server.headers[0]?.["user-agent"]).toBeTruthy();
  });
});
