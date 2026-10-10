import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Context } from "@deepseek-ai/cordis";

import { AttachmentId } from "@deepseek-ai/dsh-attachment";

import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";

import LlmRuntime, {
  createToolResultMessage,
  createUserMessage,
  LlmError,
} from "@deepseek-ai/dsh-llm";

import * as LlmPiAi from "../../src/upstream/index.js";

import { PiAiAdapter } from "../../src/upstream/index.js";

import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";

import {
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  resolveProfiles,
} from "../../src/upstream/config.js";

import { memoryAuth } from "./auth-double.js";

import { assemble } from "./assemble.js";

import { closeMockServers, mockServer, textEvents } from "./mock-server.js";

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeMockServers();
});

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${"a".repeat(64)}`),
  mediaType: "image/png",
  bytes: 1,
  width: 1,
  height: 1,
};

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
describe("provider profile lifecycle", () => {
  it("falls back to the ambient environment for apiKeyEnv without the credentials seam", async () => {
    vi.stubEnv("PI_CUSTOM_REF_KEY", "custom-ref-key");
    const server = await mockServer([{ events: textEvents }]);
    const ctx = await harness(server.url, {
      apiKey: undefined,
      apiKeyEnv: "PI_CUSTOM_REF_KEY",
    });
    await assemble(ctx, { model: "deepseek-v4-flash", messages: [] });
    expect(server.headers[0]?.authorization).toBe("Bearer custom-ref-key");
  });

  it("fails a named-but-missing apiKeyEnv instead of using another ambient key", async () => {
    // The exact confusion this guards: the named reference is empty while an
    // unrelated provider key sits in the environment. Deferring to pi-ai's own
    // discovery here would authenticate as another tenant.
    vi.stubEnv("PI_CUSTOM_REF_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "ambient-key");
    const server = await mockServer([{ events: textEvents }]);
    const ctx = await harness(server.url, {
      apiKey: undefined,
      apiKeyEnv: "PI_CUSTOM_REF_KEY",
    });
    const first = await assemble(ctx, {
      model: "deepseek-v4-flash",
      messages: [],
    });
    expect(first.finish).toMatchObject({
      kind: "error",
      failure: { code: "MISSING_CREDENTIAL" },
    });
    const second = await assemble(ctx, {
      model: "deepseek-v4-flash",
      messages: [],
    });
    expect(second.finish.kind).toBe("error");
    if (second.finish.kind !== "error")
      throw new Error("expected an error finish");
    expect(second.finish.failure.message).toMatch(
      /provider route "deepseek".*PI_CUSTOM_REF_KEY/s,
    );
    expect(server.requests).toHaveLength(0);
  });

  it("validates empty, underspecified, legacy-shaped, and explicitly blank profiles", () => {
    expect(DEFAULT_MAX_REQUEST_IMAGE_BYTES).toBe(20 * 1024 * 1024);
    // Empty and omitted dicts are the dormant zero-route posture, not errors.
    expect(resolveProfiles({}).size).toBe(0);
    expect(resolveProfiles(undefined).size).toBe(0);
    expect(() => resolveProfiles({ "": {} })).toThrow(/non-empty/);
    // A route the installed catalog does not ship is allowed, but it has no
    // defaults to fall back on: it must describe its own models.
    expect(() => resolveProfiles({ "not-real": {} })).toThrow(
      /resolves no models/,
    );
    // The pre-release array shape and its per-profile provider field fail
    // loud with migration directions instead of half-working.
    expect(() => resolveProfiles([{ provider: "openai" }] as never)).toThrow(
      /dict keyed by provider/,
    );
    expect(() =>
      resolveProfiles({ openai: { provider: "openai" } as never }),
    ).toThrow(/moved to the providers dict key/);
    expect(() => resolveProfiles({ openai: { baseURL: "" } })).toThrow(
      /empty baseURL/,
    );
    expect(() =>
      resolveProfiles({ openai: { apiKeyEnv: "not-a-var!" } }),
    ).toThrow(/must match/);
    expect(() =>
      resolveProfiles({ openai: { maxRequestImageBytes: 0 } }),
    ).toThrow(/maxRequestImageBytes/);
    expect(
      resolveProfiles({ openai: {} }).get("openai")?.maxRequestImageBytes,
    ).toBe(DEFAULT_MAX_REQUEST_IMAGE_BYTES);
    expect(
      resolveProfiles({ openai: { maxRequestImageBytes: 1024 } }).get("openai")
        ?.maxRequestImageBytes,
    ).toBe(1024);
  });

  it.each([
    ["bad header name", "value"],
    ["x-company", "line\nbreak"],
    ["x-company", "部署"],
  ])(
    "rejects provider header %j when Fetch cannot represent the entry",
    (name, value) => {
      expect(() =>
        resolveProfiles({ openai: { headers: { [name]: value } } }),
      ).toThrow(`provider "openai" header "${name}" is not valid for Fetch`);
    },
  );

  it.each(["maxRetries", "maxRetryDelayMs"] as const)(
    "rejects removed profile field %s instead of silently restoring hidden SDK retries",
    async (field) => {
      const legacy = { [field]: 2 };
      expect(() => resolveProfiles({ openai: legacy })).toThrow(
        /removed.*agent recovery/i,
      );
      const ctx = new Context();
      await ctx.plugin(LlmRuntime);
      await expect(
        ctx.plugin(LlmPiAi, { providers: { openai: legacy } }),
      ).rejects.toThrow(/removed.*agent recovery/i);
    },
  );

  it("rejects invalid stream tunables at plugin load", async () => {
    const invalid = [
      { timeoutMs: -1 },
      { websocketConnectTimeoutMs: -1 },
      { streamIdleTimeoutMs: 0 },
      { streamIdleTimeoutMs: Number.NaN },
      { streamIdleTimeoutMs: MAX_TIMER_DELAY_MS + 1 },
      { maxRequestImageBytes: 0 },
      { maxRequestImageBytes: 1.5 },
      { maxRequestImageBytes: Number.NaN },
    ];
    for (const entry of invalid) {
      const ctx = new Context();
      await ctx.plugin(LlmRuntime);
      await expect(
        ctx.plugin(LlmPiAi, { providers: { openai: { ...entry } } }),
      ).rejects.toThrow();
    }
  });

  it("rejects invalid nested retryPolicy at the provider-profile boundary", async () => {
    expect(() =>
      resolveProfiles({
        openai: {
          retryPolicy: { mode: "always", backoff: { jitterRatio: -1 } },
        },
      }),
    ).toThrow(/retryPolicy\.backoff\.jitterRatio/);

    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await expect(
      ctx.plugin(LlmPiAi, {
        providers: {
          openai: { retryPolicy: { mode: "normal", maxRetries: -1 } },
        },
      }),
    ).rejects.toThrow(/retryPolicy/);
    expect(ctx.llm.listProviders()).toEqual([]);
  });

  it("constructs the adapter directly and rejects routes it does not own", async () => {
    const adapter = adapterOf({ openai: {} });
    await expect(adapter.listModels("anthropic")).rejects.toMatchObject({
      code: "NO_ADAPTER",
    });
    await expect(
      adapter.resolveModel("anthropic", "claude-sonnet-4"),
    ).rejects.toMatchObject({ code: "NO_ADAPTER" });
    await expect(
      adapter.resolveModel("openai", "not-a-catalog-model"),
    ).rejects.toMatchObject({ code: "UNKNOWN_MODEL" });
    await expect(
      (async () => {
        for await (const _chunk of adapter.stream({
          provider: "anthropic",
          model: "claude-sonnet-4",
          messages: [],
        })) {
          /* drain */
        }
      })(),
    ).rejects.toMatchObject({ code: "NO_ADAPTER" });
    expect(new LlmError("x", "X")).toBeInstanceOf(Error);
  });

  it("rejects unsupported or unresolved image input before provider I/O", async () => {
    const adapter = adapterOf({ openai: {}, deepseek: {} });
    const drain = async (
      options: Parameters<PiAiAdapter["stream"]>[0],
    ): Promise<void> => {
      for await (const _chunk of adapter.stream(options)) {
        /* drain */
      }
    };

    await expect(
      drain({
        provider: "deepseek",
        model: "deepseek-v4-flash",
        messages: [
          createUserMessage({
            content: [{ type: "image", attachment: IMAGE_REF }],
            source: {
              kind: "model",
              provider: "deepseek-official",
              model: "deepseek-v4-flash",
            },
          }),
        ],
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
    await expect(
      drain({
        provider: "openai",
        model: "gpt-4.1",
        messages: [
          createUserMessage({
            content: [{ type: "image", attachment: IMAGE_REF }],
            source: {
              kind: "model",
              provider: "deepseek-official",
              model: "deepseek-v4-flash",
            },
          }),
        ],
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
    await expect(
      drain({
        provider: "openai",
        model: "gpt-4.1",
        messages: [
          createToolResultMessage({
            callId: "call-outer" as never,
            content: [{ type: "image", attachment: IMAGE_REF }],
            isError: false,
          }),
        ],
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
  });

  it("validates profiles at the shared resolver boundary", () => {
    expect(() =>
      resolveProfiles({
        openai: { streamIdleTimeoutMs: 0 },
      }),
    ).toThrow(/streamIdleTimeoutMs.*positive finite/);
    expect(() =>
      resolveProfiles({
        openai: { streamIdleTimeoutMs: MAX_TIMER_DELAY_MS + 1 },
      }),
    ).toThrow(/streamIdleTimeoutMs.*no greater/);
  });
});
