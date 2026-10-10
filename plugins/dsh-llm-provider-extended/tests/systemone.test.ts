import { createServer, type Server } from "node:http";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import * as Provider from "../src/upstream/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { ExtendedAdapter } from "../src/adapter.js";
import {
  Config,
  resolveProfiles,
  type Options,
} from "../src/upstream/config.js";
import {
  validateDecisionRequest,
  validateDecisionResponse,
} from "../src/systemone-contract.js";
import { memoryAuth } from "./upstream/auth-double.js";

const request = {
  state: "Synthetic support message",
  questions: {
    urgent: { type: "noul", instructions: "Is urgent?" },
    team: {
      type: "choice",
      instructions: "Select team",
      criteria: { support: null, billing: "Payment issue" },
    },
    priority: {
      type: "score",
      instructions: "Rate priority",
      criteria: ["low", "high"],
    },
  },
};
const response = {
  model: "jev-test-resolved",
  answers: {
    urgent: { type: "noul", noul: 0.7 },
    team: {
      type: "choice",
      choice: "support",
      probabilities: { support: 0.8, billing: 0.2 },
      confidence: 0.6,
    },
    priority: {
      type: "score",
      score: 0.3,
      probabilities: { "0": 0.7, "1": 0.3 },
      legend: { "0": "low", "1": "high" },
      confidence: 0.4,
    },
  },
  usage: { input_tokens: 10, output_tokens: 4 },
};
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function collect(
  stream: AsyncIterable<StreamChunk>,
): Promise<StreamChunk[]> {
  const result: StreamChunk[] = [];
  for await (const c of stream) result.push(c);
  return result;
}
function adapter(
  baseURL = "https://gateway.example.com/v1",
  timeoutMs = 60000,
) {
  const config = Config({
    providers: {
      decisions: {
        api: "systemone",
        baseURL,
        apiKeyEnv: "DEMO_DECISION_KEY",
        models: [{ id: "jev-test" }],
        timeoutMs,
      },
    },
  });
  const profiles = resolveProfiles(
    config.providers.get() as Options["providers"],
  );
  return new ExtendedAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => "synthetic-key",
    auth: memoryAuth(),
  });
}
const input: GenerateOptions = {
  provider: "decisions",
  model: "jev-test",
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: JSON.stringify(request) }],
    },
  ],
};

describe("System One", () => {
  it("works through the registered Host LLM seam without injecting chat defaults", async () => {
    const fetch = vi.fn(
      async (_url: unknown, _options?: RequestInit) =>
        new Response(JSON.stringify(response), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    const ctx = new Context();
    try {
      await ctx.plugin(LlmRuntime);
      await ctx.plugin(Provider, {
        providers: {
          decisions: {
            api: "systemone",
            baseURL: "https://gateway.example.com/v1",
            models: [{ id: "jev-test" }],
          },
        },
      });
      const metadata = await ctx.llm.resolveModelInfo("decisions", "jev-test");
      expect(metadata).toMatchObject({ inputModalities: ["text"] });
      expect(metadata).not.toHaveProperty("defaultMaxTokens");
      const chunks = await collect(ctx.llm.stream(input));
      expect(chunks.at(-1)).toEqual({
        type: "finish",
        reason: { kind: "stop" },
      });
      expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({
        model: "jev-test",
        ...request,
      });
    } finally {
      await ctx.fiber.dispose();
    }
  });
  it("retains retry status/delay and bounds credential resolution by the same deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("synthetic-error-body", {
            status: 529,
            headers: { "Retry-After": "2" },
          }),
      ),
    );
    await expect(collect(adapter().stream(input))).rejects.toMatchObject({
      code: "SERVER",
      failure: { status: 529, providerRetryAfterMs: 2000 },
    });
    const profiles = resolveProfiles({
      decisions: {
        api: "systemone",
        baseURL: "https://gateway.example.com/v1",
        models: [{ id: "jev-test" }],
        timeoutMs: 5,
      },
    });
    const provider = new ExtendedAdapter({
      profiles: () => profiles,
      resolveApiKey: () => new Promise(() => {}),
      auth: memoryAuth(),
    });
    await expect(collect(provider.stream(input))).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });
  it("validates all question kinds and exact answer identities, probabilities and fractional scores", () => {
    const native = validateDecisionRequest(request);
    expect(validateDecisionResponse(response, native)).toEqual(response);
    const invalid = [
      { ...response, answers: {} },
      { ...response, usage: { input_tokens: -1, output_tokens: 0 } },
      {
        ...response,
        answers: { ...response.answers, urgent: { type: "noul", noul: 1.1 } },
      },
      {
        ...response,
        answers: {
          ...response.answers,
          team: {
            ...response.answers.team,
            probabilities: { support: 0.1, billing: 0.2 },
          },
        },
      },
      {
        ...response,
        answers: {
          ...response.answers,
          priority: { ...response.answers.priority, score: 2 },
        },
      },
    ];
    for (const value of invalid)
      expect(() => validateDecisionResponse(value, native)).toThrow();
    expect(() => validateDecisionRequest({ messages: [] })).toThrow();
    expect(() =>
      validateDecisionRequest({
        state: "x",
        questions: { q: { type: "text", instructions: "Generate" } },
      }),
    ).toThrow();
    expect(() =>
      validateDecisionRequest({ ...request, model: "overwrite" }),
    ).toThrow();
  });
  it("advertises text metadata, sends the native wire body, emits usage before finish and preserves resolved model", async () => {
    let wire: unknown;
    let path = "";
    let authorization = "";
    let attribution = "";
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += String(c);
      wire = JSON.parse(body);
      path = req.url ?? "";
      authorization = req.headers.authorization ?? "";
      attribution = req.headers["user-agent"] ?? "";
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(response));
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    const provider = adapter(`http://127.0.0.1:${address.port}/v1`);
    expect(await provider.listModels("decisions")).toMatchObject([
      { id: "jev-test", inputModalities: ["text"] },
    ]);
    const chunks = await collect(provider.stream(input));
    expect(wire).toEqual({ model: "jev-test", ...request });
    expect(path).toBe("/v1/systemone");
    expect(authorization).toBe("Bearer synthetic-key");
    expect(attribution).toBeTruthy();
    expect(chunks.at(-2)).toEqual({
      type: "usage",
      usage: { inputTokens: 10, outputTokens: 4 },
    });
    expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "stop" } });
    const text = chunks.find((c) => c.type === "text-delta");
    expect(text?.type === "text-delta" && JSON.parse(text.text)).toEqual(
      response,
    );
  });
  it("rejects unsupported options and ordinary chat before any HTTP request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const opts of [
      { ...input, temperature: 0 },
      {
        ...input,
        tools: [{ name: "demo", description: "demo", parameters: {} }],
      },
      {
        ...input,
        messages: [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: "Write a poem" }],
          },
        ],
      },
      { ...input, maxTokens: 1 },
    ])
      await expect(collect(adapter().stream(opts))).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(() =>
      resolveProfiles({
        d: {
          api: "systemone",
          baseURL: "https://gateway.example.com/v1",
          models: [{ id: "m" }],
          generation: { temperature: 0 },
        },
      }),
    ).toThrow(/sampling/);
  });
  it("maps HTTP failures without exposing body secrets and honors caller cancellation/deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("synthetic-secret", { status: 401 })),
    );
    await expect(collect(adapter().stream(input))).rejects.toMatchObject({
      code: "AUTH",
      message: "System One request failed with HTTP 401",
    });
    const aborted = AbortSignal.abort();
    await expect(
      collect(adapter().stream({ ...input, signal: aborted })),
    ).rejects.toThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, opts: RequestInit) =>
          new Promise((_resolve, reject) =>
            opts.signal?.addEventListener("abort", () =>
              reject(new Error("timeout")),
            ),
          ),
      ),
    );
    await expect(
      collect(adapter("https://gateway.example.com/v1", 5).stream(input)),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
