import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";

import LlmRuntime, { LlmError } from "@deepseek-ai/dsh-llm";
import * as LlmPiAi from "../../src/upstream/index.js";
import { PiAiAdapter } from "../../src/upstream/index.js";

import { resolveProfiles } from "../../src/upstream/config.js";
import { memoryAuth } from "./auth-double.js";
import { assemble } from "./assemble.js";
import { closeMockServers, mockServer, textEvents } from "./mock-server.js";

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeMockServers();
});

async function harness(
  baseURL: string,
  overrides: Record<string, unknown> = {},
): Promise<Context> {
  vi.stubEnv("PI_TEST_KEY", "test-key");
  const ctx = new Context();
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(LlmPiAi, {
    providers: {
      deepseek: { apiKeyEnv: "PI_TEST_KEY", baseURL, ...overrides },
    },
  });
  return ctx;
}

/** Direct adapter over the real profile resolver, with a fixed key per call. */
function adapterOf(
  providers: Record<string, LlmPiAi.PiAiProviderProfile>,
  apiKey: string | undefined = "test-key",
): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles(providers),
    resolveApiKey: () => Promise.resolve(apiKey),
    auth: memoryAuth(),
  });
}

beforeEach(() => {
  // Configuration carries only the reference; these mounts resolve it from
  // the environment, which is the whole credential plane without a seam.
  vi.stubEnv("PI_TEST_KEY", "test-key");
});

describe("abort wiring", () => {
  it("preserves an unknown pre-dispatch adapter Error exactly", async () => {
    const original = new Error("SDK context conversion exploded");
    const message = Object.defineProperty({}, "content", {
      get() {
        throw original;
      },
    });
    const adapter = adapterOf({ deepseek: {} });
    const drain = async (): Promise<void> => {
      for await (const _chunk of adapter.stream({
        provider: "deepseek",
        model: "deepseek-v4-flash",
        messages: [message as never],
      })) {
        /* drain */
      }
    };

    await expect(drain()).rejects.toBe(original);
  });

  it("lets a concurrent caller abort classify a pre-dispatch adapter failure", async () => {
    const controller = new AbortController();
    const original = new Error("conversion lost its caller");
    const message = Object.defineProperty({}, "content", {
      get() {
        controller.abort("caller cancelled during conversion");
        throw original;
      },
    });
    const adapter = adapterOf({ deepseek: {} });
    const drain = async (): Promise<void> => {
      for await (const _chunk of adapter.stream({
        provider: "deepseek",
        model: "deepseek-v4-flash",
        messages: [message as never],
        signal: controller.signal,
      })) {
        /* drain */
      }
    };

    await expect(drain()).rejects.toMatchObject({
      code: "ABORTED",
      cause: original,
    });
  });

  it("resolves catalog endpoints without an override before honoring pre-abort", async () => {
    const adapter = adapterOf({ deepseek: {} });
    const controller = new AbortController();
    controller.abort("already stopped");
    const chunks = [];
    for await (const chunk of adapter.stream({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      messages: [],
      signal: controller.signal,
    }))
      chunks.push(chunk);
    expect(chunks.at(-1)).toMatchObject({
      type: "finish",
      reason: { kind: "aborted", failure: { code: "ABORTED" } },
    });
  });

  it("honors a pre-aborted caller signal", async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 20 }]);
    const ctx = await harness(server.url);
    const controller = new AbortController();
    controller.abort("already stopped");
    const result = await assemble(ctx, {
      model: "deepseek-v4-flash",
      messages: [],
      signal: controller.signal,
    });
    expect(result.finish.kind).toBe("aborted");
  });

  it("forwards an abort that arrives while provider streaming is active", async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 30 }]);
    const ctx = await harness(server.url);
    const controller = new AbortController();
    const resultPromise = assemble(ctx, {
      model: "deepseek-v4-flash",
      messages: [],
      signal: controller.signal,
    });
    setTimeout(() => {
      controller.abort("stopped during stream");
    }, 10);
    const result = await resultPromise;
    expect(result.finish.kind).toBe("aborted");
  });

  it("aborts upstream when a consumer stops early", async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 30 }]);
    const ctx = await harness(server.url);
    for await (const chunk of ctx.llm.stream({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      messages: [],
    })) {
      if (chunk.type === "block-start") break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.requests).toHaveLength(1);
  });
});

it.each([
  new LlmError("missing credential", "MISSING_CREDENTIAL"),
  new LlmError("invalid credential", "INVALID_CREDENTIAL"),
  new Error("credential storage failed"),
])(
  "retains its configured catalog independently of credential failures: $message",
  async (error) => {
    const adapter = new PiAiAdapter({
      profiles: () =>
        resolveProfiles({ deepseek: { apiKeyEnv: "PI_TEST_KEY" } }),
      resolveApiKey: () => Promise.reject(error),
      auth: memoryAuth(),
    });
    expect(await adapter.listModels("deepseek")).not.toHaveLength(0);
  },
);
