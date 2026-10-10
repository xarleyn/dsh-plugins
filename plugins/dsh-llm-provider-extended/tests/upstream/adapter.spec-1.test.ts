import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Context, Service } from "@deepseek-ai/cordis";
import {
  AttachmentId,
  AttachmentStore,
  ImageVariantId,
} from "@deepseek-ai/dsh-attachment";
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from "@deepseek-ai/dsh-attachment";
import LlmRuntime, {
  createUserMessage,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  ReasoningEffortId,
  userAgent,
} from "@deepseek-ai/dsh-llm";
import * as LlmPiAi from "../../src/upstream/index.js";
import { PiAiAdapter } from "../../src/upstream/index.js";

import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { resolveProfiles } from "../../src/upstream/config.js";
import { memoryAuth } from "./auth-double.js";
import { assemble } from "./assemble.js";
import { closeMockServers, mockServer, textEvents } from "./mock-server.js";

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeMockServers();
});

const HOST_IMAGE_PATH = "/host/.dsh/attachments/objects/aa/object";
const MODEL_IMAGE_PATH = "/model/.dsh/attachments/objects/aa/object";

class MappedFileSystem extends Service {
  constructor(ctx: Context) {
    super(ctx, "fs");
  }

  processPathFromHostPath(hostPath: string): string | undefined {
    return hostPath === HOST_IMAGE_PATH ? MODEL_IMAGE_PATH : undefined;
  }
}

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

describe("PiAiAdapter provider routing", () => {
  it("resolves a catalog model dynamically and uses a private endpoint", async () => {
    const server = await mockServer([{ events: textEvents }]);
    const ctx = await harness(server.url);
    const result = await assemble(ctx, {
      model: "deepseek-v4-flash",
      messages: [
        createUserMessage({
          content: [{ type: "text", text: "hi" }],
          source: {
            kind: "model",
            provider: "deepseek-official",
            model: "deepseek-v4-flash",
          },
        }),
      ],
    });
    expect(result.message.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.finish).toEqual({ kind: "stop" });
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 1,
      totalTokens: 4,
    });
    expect(server.paths).toEqual(["/chat/completions"]);
  });

  it("keeps prepared model metadata and dispatch on one profile snapshot", async () => {
    const first = await mockServer([{ events: textEvents }]);
    const second = await mockServer([]);
    let providers: Record<string, LlmPiAi.PiAiProviderProfile> = {
      deepseek: { apiKeyEnv: "PI_TEST_KEY", baseURL: first.url },
    };
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    ctx.llm.registerAdapter(
      ["deepseek"],
      new PiAiAdapter({
        profiles: () => resolveProfiles(providers),
        resolveApiKey: () => Promise.resolve("test-key"),
        auth: memoryAuth(),
      }),
    );

    const prepared = await ctx.llm.prepareCall({
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });
    providers = { deepseek: { apiKeyEnv: "PI_TEST_KEY", baseURL: second.url } };
    const chunks: unknown[] = [];
    for await (const chunk of prepared.stream({
      ...prepared.config,
      messages: [],
    }))
      chunks.push(chunk);

    expect(chunks.length).toBeGreaterThan(0);
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(0);
  });

  it("merges profile headers with Harness attribution winning", async () => {
    const server = await mockServer([{ events: textEvents }]);
    const ctx = await harness(server.url, {
      headers: { "x-company": "private", "User-Agent": "wrong" },
    });
    await assemble(ctx, { model: "deepseek-v4-flash", messages: [] });
    expect(server.headers[0]?.["x-company"]).toBe("private");
    expect(server.headers[0]?.["user-agent"]).toBe(userAgent());
  });

  it("forwards common stream options and profile reasoning", async () => {
    const server = await mockServer([{ events: textEvents }]);
    const ctx = await harness(server.url, {
      reasoning: "max",
      cacheRetention: "none",
      transport: "sse",
      timeoutMs: 5000,
      websocketConnectTimeoutMs: 3000,
      streamIdleTimeoutMs: 10_000,
      thinkingBudgets: { high: 2048 },
    });
    await assemble(ctx, {
      model: "deepseek-v4-pro",
      messages: [],
      temperature: 0.2,
      maxTokens: 77,
      sessionId: "session-for-pi" as never,
    });
    expect(server.requests[0]).toMatchObject({
      model: "deepseek-v4-pro",
      temperature: 0.2,
      max_tokens: 77,
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    });
    expect(server.requests[0]).not.toHaveProperty("dsh_session_log");
    expect(server.requests[0]).not.toHaveProperty("dsh_plugin_packages");
  });

  it("uses a dynamic request effort and reports unsupported efforts before network I/O", async () => {
    const server = await mockServer([
      { events: textEvents },
      { events: textEvents },
    ]);
    const ctx = await harness(server.url, { reasoning: "max" });

    await assemble(ctx, {
      model: "deepseek-v4-flash",
      reasoningEffort: ReasoningEffortId("high"),
      messages: [],
    });
    expect(server.requests[0]).toMatchObject({ reasoning_effort: "high" });

    await assemble(ctx, {
      model: "deepseek-v4-flash",
      reasoningEffort: ReasoningEffortId("off"),
      messages: [],
    });
    expect(server.requests[1]).toMatchObject({
      thinking: { type: "disabled" },
    });
    expect(server.requests[1]).not.toHaveProperty("reasoning_effort");

    const unsupported = await assemble(ctx, {
      model: "deepseek-v4-flash",
      reasoningEffort: ReasoningEffortId("xhigh"),
      messages: [],
    });
    expect(unsupported.finish).toMatchObject({
      kind: "error",
      failure: { code: "UNSUPPORTED_REASONING_EFFORT" },
    });
    expect(server.requests).toHaveLength(2);
  });

  it("preserves omitted profile options when constructing the adapter directly", async () => {
    const server = await mockServer([{ events: textEvents }]);
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    ctx.llm.registerAdapter(
      ["deepseek"],
      adapterOf({
        deepseek: { apiKeyEnv: "PI_TEST_KEY", baseURL: server.url },
      }),
    );

    const result = await assemble(ctx, {
      model: "deepseek-v4-flash",
      messages: [],
    });

    expect(result.message.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("names a route by its displayName, and by its own key once the profiles drop it", () => {
    const adapter = adapterOf({
      "acme-gateway": {
        displayName: "Acme Gateway",
        api: "openai-completions",
        baseURL: "https://acme.test/v1",
        models: [{ id: "acme-large" }],
      },
    });
    expect(adapter.providerInfo("acme-gateway")).toEqual({
      id: "acme-gateway",
      name: "Acme Gateway",
    });

    // The registry and the profiles can disagree for a moment: a refused
    // registration swap leaves the previous routes serving while resolution
    // has already moved on, so a selector may ask about a route the current
    // profiles no longer describe. It gets the key rather than nothing.
    expect(adapter.providerInfo("departed")).toEqual({
      id: "departed",
      name: "departed",
    });
  });

  it("sends explicitly supplied stop sequences through the supported chat protocol", async () => {
    const server = await mockServer([{ events: textEvents }]);
    const ctx = await harness(server.url);
    const result = await assemble(ctx, {
      model: "deepseek-v4-flash",
      messages: [],
      stop: ["END"],
    });
    expect(result.finish).toMatchObject({ kind: "stop" });
    expect(server.requests[0]).toMatchObject({ stop: ["END"] });
  });

  it("reports unknown catalog models before network I/O", async () => {
    const server = await mockServer([]);
    const ctx = await harness(server.url);
    const result = await assemble(ctx, {
      model: "not-in-the-catalog",
      messages: [],
    });
    expect(result.finish).toMatchObject({
      kind: "error",
      failure: { code: "UNKNOWN_MODEL" },
    });
    expect(server.requests).toEqual([]);
  });

  it("uses the catalog API implementation, including OpenAI Responses", async () => {
    const server = await mockServer([
      {
        status: 401,
        body: JSON.stringify({ error: { message: "expected mock failure" } }),
      },
    ]);
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, {
      providers: {
        openai: { apiKeyEnv: "PI_TEST_KEY", baseURL: `${server.url}/v1` },
      },
    });
    const result = await assemble(ctx, {
      provider: "openai",
      model: "gpt-4.1",
      messages: [],
    });
    expect(result.finish.kind).toBe("error");
    expect(server.paths).toEqual(["/v1/responses"]);
  });

  it("resolves attachment and filesystem services mounted after the adapter when dispatching an image", async () => {
    const server = await mockServer([
      {
        status: 401,
        body: JSON.stringify({ error: { message: "expected mock failure" } }),
      },
    ]);
    const attachmentId = AttachmentId(`sha256:${"a".repeat(64)}`);
    const ref: ImageAttachmentRef = {
      attachmentId,
      mediaType: "image/png",
      bytes: 1,
      width: 1,
      height: 1,
    };
    const readImage = vi.fn(
      (_ref: ImageAttachmentRef): Promise<StoredImageAttachment> =>
        Promise.resolve({ ref, data: Uint8Array.of(1) }),
    );
    const readImageRequest = vi.fn(
      (
        value: ImageAttachmentRef,
        _target: ImageRequestTarget,
        _signal?: AbortSignal,
      ): Promise<RequestImageAttachment> =>
        Promise.resolve({
          variantId: ImageVariantId(`sha256:${"b".repeat(64)}`),
          attachment: value,
          data: Uint8Array.of(1),
          mediaType: value.mediaType,
          bytes: 1,
          width: value.width,
          height: value.height,
          depth: "uchar",
          space: "srgb",
          hasAlpha: true,
        }),
    );

    class LateAttachmentStore extends AttachmentStore {
      readonly imageLimits: ImageAttachmentLimits = {
        maxImageBytes: 1,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1,
        maxImagePixels: 1,
        maxImageDimension: 2000,
        mediaTypes: ["image/png"],
      };

      validateImage(_input: SaveImageAttachment): Promise<void> {
        return Promise.reject(new Error("not used"));
      }

      saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        return Promise.reject(new Error("not used"));
      }

      readImage(value: ImageAttachmentRef): Promise<StoredImageAttachment> {
        return readImage(value);
      }

      override imageHostPath(_ref: ImageAttachmentRef): string {
        return HOST_IMAGE_PATH;
      }

      override readImageRequest(
        value: ImageAttachmentRef,
        policy: ImageRequestTarget,
        signal?: AbortSignal,
      ): Promise<RequestImageAttachment> {
        return readImageRequest(value, policy, signal);
      }
    }

    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, {
      providers: {
        openai: { apiKeyEnv: "PI_TEST_KEY", baseURL: `${server.url}/v1` },
      },
    });
    await ctx.plugin(LateAttachmentStore);
    await ctx.plugin(MappedFileSystem);

    const result = await assemble(ctx, {
      provider: "openai",
      model: "gpt-4.1",
      messages: [
        createUserMessage({
          content: [{ type: "image", attachment: ref }],
          source: {
            kind: "model",
            provider: "deepseek-official",
            model: "deepseek-v4-flash",
          },
        }),
      ],
    });

    expect(result.finish.kind).toBe("error");
    expect(readImageRequest).toHaveBeenCalledWith(
      ref,
      {
        width: 1,
        height: 1,
        maxBytes: 1024 * 1024,
      },
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(server.requests[0])).toContain(MODEL_IMAGE_PATH);
    expect(server.paths).toEqual(["/v1/responses"]);
  });

  it("forces one wire request for an SDK-retryable provider failure", async () => {
    const server = await mockServer([
      {
        status: 429,
        headers: { "retry-after-ms": "1" },
        body: JSON.stringify({
          error: { message: "retryable provider failure" },
        }),
      },
      {
        status: 500,
        body: JSON.stringify({ error: { message: "hidden SDK retry" } }),
      },
      {
        status: 500,
        body: JSON.stringify({ error: { message: "second hidden SDK retry" } }),
      },
    ]);
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, {
      providers: {
        openai: { apiKeyEnv: "PI_TEST_KEY", baseURL: `${server.url}/v1` },
      },
    });

    const result = await assemble(ctx, {
      provider: "openai",
      model: "gpt-4.1",
      messages: [],
    });

    expect(result.finish).toMatchObject({ kind: "error" });
    expect(server.paths).toEqual(["/v1/responses"]);
  });

  it("uses OpenAI Responses against an Azure project v1 path with its API key header", async () => {
    const server = await mockServer([
      {
        status: 401,
        body: JSON.stringify({ error: { message: "expected mock failure" } }),
      },
    ]);
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, {
      providers: {
        openai: {
          apiKeyEnv: "PI_TEST_KEY",
          baseURL: `${server.url}/api/projects/openai/openai/v1`,
          headers: { "api-key": "test-key", Authorization: "" },
        },
      },
    });
    const result = await assemble(ctx, {
      provider: "openai",
      model: "gpt-5.5",
      messages: [],
    });
    expect(result.finish.kind).toBe("error");
    expect(server.paths).toEqual(["/api/projects/openai/openai/v1/responses"]);
    expect(server.headers[0]?.["api-key"]).toBe("test-key");
    expect(server.headers[0]?.authorization).toBe("");
  });

  it.each([
    [401, "AUTH"],
    [400, "INVALID_REQUEST"],
    [429, "RATE_LIMIT"],
    [500, "SERVER"],
  ] as const)("maps HTTP %s failures to %s", async (status, code) => {
    const server = await mockServer([
      {
        status,
        body: JSON.stringify({ error: { message: `provider ${status}` } }),
      },
    ]);
    const ctx = await harness(server.url);
    const result = await assemble(ctx, {
      model: "deepseek-v4-flash",
      messages: [],
    });
    expect(result.finish).toMatchObject({ kind: "error", failure: { code } });
    expect(server.paths).toEqual(["/chat/completions"]);
  });

  it("uses the resolved catalog context window for usage-based overflow detection", async () => {
    const model = getBuiltinModels("deepseek").find(
      (candidate) => candidate.id === "deepseek-v4-flash",
    );
    if (model === undefined)
      throw new Error("deepseek-v4-flash missing from pi-ai test catalog");
    const events = [
      '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
      JSON.stringify({
        choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
        usage: { prompt_tokens: model.contextWindow + 1, completion_tokens: 0 },
      }),
      "[DONE]",
    ];
    const server = await mockServer([{ events }]);
    const ctx = await harness(server.url);

    const result = await assemble(ctx, { model: model.id, messages: [] });

    expect(result.finish).toEqual({
      kind: "error",
      failure: {
        message: `pi-ai detected context overflow for model "${model.id}"`,
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    });
  });

  it("stops the SDK request when the adapter idle watchdog expires", async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 200 }]);
    const ctx = await harness(server.url, { streamIdleTimeoutMs: 20 });

    const result = await assemble(ctx, {
      model: "deepseek-v4-flash",
      messages: [],
    });
    expect(result.finish).toMatchObject({
      kind: "error",
      failure: { code: "TIMEOUT" },
    });
    await Promise.race([
      server.responseClosed,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("SDK request did not close after idle timeout"));
        }, 1_000);
      }),
    ]);

    expect(server.paths).toEqual(["/chat/completions"]);
    expect(server.closedResponses).toBe(1);
  });
});
