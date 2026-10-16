import { afterEach, describe, expect, it, vi } from "vitest";
import { Context, Service } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import LlmRuntime, {
  type GenerateOptions,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import { ExtendedAdapter } from "../src/adapter.js";
import * as Provider from "../src/index.js";
import {
  Config,
  resolveProfiles,
  type Options,
} from "../src/upstream/config.js";
import {
  resolveUserIdentity,
  userIdentityPayload,
} from "../src/user-identity.js";
import { memoryAuth } from "./upstream/auth-double.js";
import {
  closeMockServers,
  mockServer,
  textEvents,
} from "./upstream/mock-server.js";

afterEach(closeMockServers);
const input: GenerateOptions = {
  provider: "demo",
  model: "m",
  messages: [
    { role: "user", content: [{ type: "text", text: "Synthetic request" }] },
  ],
};
const sessionId = (id: string) =>
  brandString<NonNullable<GenerateOptions["sessionId"]>>(id);
async function collect(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
function profiles(url: string, enabled = true) {
  return resolveProfiles({
    demo: {
      api: "openai-completions",
      baseURL: url,
      models: [{ id: "m" }],
      ...(enabled ? { userIdentity: "qa-account" as const } : {}),
    },
  });
}

describe("per-request QA user identity", () => {
  it.each([
    ["openai-responses", "user"],
    ["anthropic-messages", "metadata"],
  ])(
    "sends the trusted field through the real %s SDK transport",
    async (api, field) => {
      const server = await mockServer([
        {
          status: 400,
          body: '{"error":{"message":"Synthetic request capture","type":"bad_request"}}',
        },
      ]);
      const adapter = new ExtendedAdapter({
        profiles: () =>
          resolveProfiles({
            demo: {
              api,
              baseURL: server.url,
              models: [{ id: "m" }],
              userIdentity: "qa-account",
            },
          }),
        resolveApiKey: async () => "shared-demo-key",
        auth: memoryAuth(),
        resolveUserId: () => "qa_u_sdk",
      });
      const chunks = await collect(
        adapter.stream({ ...input, sessionId: sessionId("chat") }),
      );
      expect(chunks.at(-1)).toMatchObject({
        type: "finish",
        reason: { kind: "error" },
      });
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]).toMatchObject(
        field === "metadata"
          ? { metadata: { user_id: "qa_u_sdk" } }
          : { user: "qa_u_sdk" },
      );
    },
  );
  it("is opt-in in the schema and uses the exact protocol field without changing other data", () => {
    const config = Config({
      providers: {
        demo: {
          api: "openai-completions",
          baseURL: "https://gateway.example.com",
          models: [{ id: "m" }],
        },
      },
    });
    expect(config.providers.get()["demo"]?.userIdentity).toBeUndefined();
    const body = {
      model: "m",
      messages: [],
      tools: [],
      metadata: { custom: "retained", user_id: "sdk-default" },
    };
    expect(
      userIdentityPayload(body, "qa_u_demo", "openai-completions"),
    ).toEqual({ ...body, user_id: "qa_u_demo" });
    expect(userIdentityPayload(body, "qa_u_demo", "openai-responses")).toEqual({
      ...body,
      user: "qa_u_demo",
    });
    expect(
      userIdentityPayload(body, "qa_u_demo", "anthropic-messages"),
    ).toEqual({
      ...body,
      metadata: { custom: "retained", user_id: "qa_u_demo" },
    });
    expect(body.metadata.user_id).toBe("sdk-default");
    expect(userIdentityPayload(body, undefined, "systemone")).toBe(body);
    expect(() => userIdentityPayload(body, "qa_u_demo", "systemone")).toThrow(
      /cannot carry/,
    );
  });
  it("refuses missing/invalid/untrusted identities and unsupported protocols before any HTTP", async () => {
    expect(() =>
      resolveUserIdentity(
        "qa-account",
        "openai-completions",
        input,
        () => "qa_u_demo",
      ),
    ).toThrow(/attested/);
    expect(() =>
      resolveUserIdentity(
        "qa-account",
        "openai-completions",
        { ...input, sessionId: sessionId("s") },
        () => "email@example.test",
      ),
    ).toThrow(/invalid/);
    expect(() =>
      resolveUserIdentity(
        "qa-account",
        "systemone",
        { ...input, sessionId: sessionId("s") },
        () => "qa_u_demo",
      ),
    ).toThrow(/supported/);
    expect(() =>
      resolveProfiles({
        demo: {
          api: "google-generative-ai",
          baseURL: "https://gateway.example.com",
          models: [{ id: "m" }],
          userIdentity: "qa-account",
        },
      }),
    ).toThrow(/supported/);
    const native = Config({
      providers: {
        demo: {
          api: "systemone",
          baseURL: "https://gateway.example.com/v1",
          models: [{ id: "m" }],
          userIdentity: "qa-account",
        },
      },
    });
    expect(() =>
      resolveProfiles(native.providers.get() as Options["providers"]),
    ).toThrow(/supported/);
    const server = await mockServer([]),
      key = vi.fn(async () => "shared-demo-key");
    const adapter = new ExtendedAdapter({
      profiles: () => profiles(server.url),
      resolveApiKey: key,
      auth: memoryAuth(),
      resolveUserId: () => undefined,
    });
    await expect(
      collect(adapter.stream({ ...input, sessionId: sessionId("unowned") })),
    ).rejects.toMatchObject({ code: "MISSING_USER_ID" });
    expect(key).not.toHaveBeenCalled();
    expect(server.requests).toHaveLength(0);
  });
  it("freezes identity before credential awaits while overlapping users keep one shared key", async () => {
    const server = await mockServer([
      { events: textEvents },
      { events: textEvents },
    ]);
    let current = "qa_u_first";
    let release!: () => void;
    const ready = new Promise<void>((accept) => {
      release = accept;
    });
    const key = vi.fn(async () => {
      await ready;
      return "shared-demo-key";
    });
    const adapter = new ExtendedAdapter({
      profiles: () => profiles(server.url),
      resolveApiKey: key,
      auth: memoryAuth(),
      resolveUserId: () => current,
    });
    const first = collect(
      adapter.stream({ ...input, sessionId: sessionId("chat-first") }),
    );
    await Promise.resolve();
    current = "qa_u_second";
    const second = collect(
      adapter.stream({ ...input, sessionId: sessionId("chat-second") }),
    );
    await Promise.resolve();
    current = "qa_u_changed_after_capture";
    release();
    await Promise.all([first, second]);
    expect(
      server.requests
        .map((r) => (r as Record<string, unknown>)["user_id"])
        .sort(),
    ).toEqual(["qa_u_first", "qa_u_second"]);
    expect(server.headers.map((h) => h["authorization"])).toEqual([
      "Bearer shared-demo-key",
      "Bearer shared-demo-key",
    ]);
    expect(
      server.requests.every(
        (r) => (r as Record<string, unknown>)["model"] === "m",
      ),
    ).toBe(true);
  });
  it("keeps normal routes unchanged and resolves the Host identity service per call", async () => {
    const server = await mockServer([
      { events: textEvents },
      { events: textEvents },
    ]);
    const resolver = vi.fn(() => "qa_u_unused");
    const normal = new ExtendedAdapter({
      profiles: () => profiles(server.url, false),
      resolveApiKey: async () => "shared-demo-key",
      auth: memoryAuth(),
      resolveUserId: resolver,
    });
    await collect(normal.stream(input));
    expect(resolver).not.toHaveBeenCalled();
    expect(server.requests[0]).not.toHaveProperty("user_id");
    const ctx = new Context();
    try {
      await ctx.plugin(LlmRuntime);
      await ctx.plugin(Provider, {
        providers: {
          demo: {
            api: "openai-completions",
            baseURL: server.url,
            models: [{ id: "m" }],
            apiKeyEnv: "DEMO_SHARED_KEY",
            userIdentity: "qa-account",
          },
        },
      } as Options);
      new (class extends Service {
        constructor() {
          super(ctx, "credentials");
        }
        async resolve() {
          return { value: "shared-demo-key" };
        }
      })();
      new (class extends Service {
        constructor() {
          super(ctx, "qaLlmIdentity");
        }
        forSession(id: string) {
          return id === "chat" ? "qa_u_host" : undefined;
        }
      })();
      const chunks = await collect(
        ctx.llm.stream({ ...input, sessionId: sessionId("chat") }),
      );
      expect(chunks.at(-1)).toMatchObject({
        type: "finish",
        reason: { kind: "stop" },
      });
      expect(server.requests[1]).toHaveProperty("user_id", "qa_u_host");
    } finally {
      await ctx.fiber.dispose();
    }
  });
});
