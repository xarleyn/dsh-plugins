import { createServer } from "node:http";

import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Context } from "@deepseek-ai/cordis";

import LlmRuntime, { userAgent } from "@deepseek-ai/dsh-llm";

import * as LlmPiAi from "../../src/upstream/index.js";

const servers: Server[] = [];

/** Credential variables a test set, cleared so the next one starts unset. */
const touchedEnv: string[] = [];

afterEach(async () => {
  // A no-op when the test never stubbed `fetch`; only 'probe key format'
  // below installs one.
  vi.unstubAllGlobals();
  for (const name of touchedEnv.splice(0))
    Reflect.deleteProperty(process.env, name);
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

interface ListingServer {
  url: string;
  paths: string[];
  headers: IncomingMessage["headers"][];
}

/**
 * A stand-in provider that answers one scripted `GET /models`. `chunks` writes
 * without a declared length, which is how a real streamed reply arrives.
 */
async function listingServer(behavior: {
  status?: number;
  body?: string;
  chunks?: string[];
  holdOpenMs?: number;
}): Promise<ListingServer> {
  const paths: string[] = [];
  const headers: IncomingMessage["headers"][] = [];
  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      paths.push(request.url ?? "");
      headers.push(request.headers);
      if (behavior.chunks !== undefined) {
        // No declared length: the ceiling has to hold on what is read.
        response.writeHead(behavior.status ?? 200, {
          "content-type": "application/json",
        });
        for (const chunk of behavior.chunks) response.write(chunk);
        if (behavior.holdOpenMs === undefined) {
          response.end();
          return;
        }
        // Left open so a caller's cancellation lands while the body is still
        // being read rather than after it completed.
        setTimeout(() => {
          response.end();
        }, behavior.holdOpenMs);
        return;
      }
      const body = behavior.body ?? "{}";
      response.writeHead(behavior.status ?? 200, {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      });
      response.end(body);
    },
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("no port");
  return { url: `http://127.0.0.1:${address.port}`, paths, headers };
}

/** A bare dormant mount: discovery is offered whether or not a route exists. */
async function harness(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(LlmPiAi, {});
  return ctx;
}

/**
 * Replies recorded from live endpoints on 2026-09-02, plus the reply
 * Anthropic's List Models reference documents. Each file keeps the reply's
 * top-level fields and entry objects verbatim; only a recorded entry list is
 * cut down to the named entries so the archive stays small.
 */

describe("draft-provider model discovery", () => {
  it("reads an OpenAI-compatible listing and keeps the capacities it discloses", async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          {
            id: "acme-large",
            display_name: "Acme Large",
            context_length: 65_536,
            max_output_tokens: 4096,
          },
          {
            id: "acme-camel",
            displayName: "Acme Camel",
            contextWindow: 131_072,
            maxOutputTokens: 8192,
          },
          {
            id: "acme-mixed",
            name: "Acme Mixed",
            context_window: 32_768,
            maxTokens: 2048,
          },
          { id: "acme-legacy", max_tokens: 1024 },
          { id: "acme-small" },
        ],
      }),
    });
    const ctx = await harness();

    const models = await ctx.llm.discoverModels("dsh-llm-provider-extended", {
      baseURL: `${server.url}/v1`,
      apiKey: "probe-key",
    });

    expect(models).toEqual([
      {
        id: "acme-large",
        name: "Acme Large",
        contextWindow: 65_536,
        maxTokens: 4096,
      },
      {
        id: "acme-camel",
        name: "Acme Camel",
        contextWindow: 131_072,
        maxTokens: 8192,
      },
      {
        id: "acme-mixed",
        name: "Acme Mixed",
        contextWindow: 32_768,
        maxTokens: 2048,
      },
      { id: "acme-legacy", name: "acme-legacy", maxTokens: 1024 },
      { id: "acme-small", name: "acme-small" },
    ]);
    expect(server.paths).toEqual(["/v1/models"]);
    expect(server.headers[0]?.authorization).toBe("Bearer probe-key");
    expect(server.headers[0]?.["user-agent"]).toBe(userAgent());
  });

  it("reads an enriched models map using route ids and nested capacities", async () => {
    const server = await listingServer({
      body: JSON.stringify({
        models: {
          "lobechat-deepseek-chat": {
            id: "deepseek/deepseek-v4-flash",
            name: "DeepSeek V4 Flash",
            limit: { context: 1_048_576, output: 384_000 },
          },
          "bare-route": {},
          "": { id: "nested-id", display_name: "Nested fallback" },
          "malformed-route": null,
          "primitive-route": "not a model record",
        },
      }),
    });
    const ctx = await harness();

    expect(
      await ctx.llm.discoverModels("dsh-llm-provider-extended", {
        baseURL: server.url,
      }),
    ).toEqual([
      {
        id: "lobechat-deepseek-chat",
        name: "DeepSeek V4 Flash",
        contextWindow: 1_048_576,
        maxTokens: 384_000,
      },
      { id: "bare-route", name: "bare-route" },
      { id: "nested-id", name: "Nested fallback" },
    ]);
  });

  it("uses Anthropic model-listing paths, headers, and capacity fields", async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          {
            id: "claude-sonnet",
            display_name: "Claude Sonnet",
            max_input_tokens: 200_000,
            max_tokens: 64_000,
          },
        ],
      }),
    });
    const ctx = await harness();

    const rootModels = await ctx.llm.discoverModels(
      "dsh-llm-provider-extended",
      {
        baseURL: server.url,
        api: "anthropic-messages",
        apiKey: "anthropic-key",
      },
    );
    const versionedModels = await ctx.llm.discoverModels(
      "dsh-llm-provider-extended",
      {
        baseURL: `${server.url}/v1`,
        api: "anthropic-messages",
        apiKey: "anthropic-key",
      },
    );
    await ctx.llm.discoverModels("dsh-llm-provider-extended", {
      baseURL: server.url,
      api: "anthropic-messages",
    });

    expect(rootModels).toEqual([
      {
        id: "claude-sonnet",
        name: "Claude Sonnet",
        contextWindow: 200_000,
        maxTokens: 64_000,
      },
    ]);
    expect(versionedModels).toEqual(rootModels);
    expect(server.paths).toEqual([
      "/v1/models?limit=1000",
      "/v1/models?limit=1000",
      "/v1/models?limit=1000",
    ]);
    expect(server.headers.map((headers) => headers["x-api-key"])).toEqual([
      "anthropic-key",
      "anthropic-key",
      undefined,
    ]);
    expect(
      server.headers.map((headers) => headers["anthropic-version"]),
    ).toEqual(["2023-06-01", "2023-06-01", "2023-06-01"]);
    expect(server.headers.map((headers) => headers.authorization)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(server.headers.map((headers) => headers["user-agent"])).toEqual([
      userAgent(),
      userAgent(),
      userAgent(),
    ]);
  });

  it("prefers the standard data array when both supported formats are present", async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [{ id: "standard" }],
        models: { enriched: { name: "Enriched" } },
      }),
    });
    const ctx = await harness();

    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        baseURL: server.url,
      }),
    ).resolves.toEqual([{ id: "standard", name: "standard" }]);
  });

  it("keeps a deployment path instead of resolving it away", async () => {
    const server = await listingServer({
      body: JSON.stringify({ data: [{ id: "m" }] }),
    });
    const ctx = await harness();

    await ctx.llm.discoverModels("dsh-llm-provider-extended", {
      baseURL: `${server.url}/openai/v1/`,
    });

    expect(server.paths).toEqual(["/openai/v1/models"]);
  });

  it("offers no credential when the draft names none", async () => {
    const server = await listingServer({
      body: JSON.stringify({ data: [{ id: "m" }] }),
    });
    const ctx = await harness();

    await ctx.llm.discoverModels("dsh-llm-provider-extended", {
      baseURL: server.url,
    });

    expect(server.headers[0]?.authorization).toBeUndefined();
  });

  it("authenticates configured routes the draft cannot supply a key for", async () => {
    // What the Models page actually sends after a key is saved: the form holds
    // the redacted descriptor, so the draft names the route and the endpoint
    // and no credential at all. Interrogating unauthenticated would answer 401
    // and read as a wrong key.
    const server = await listingServer({
      body: JSON.stringify({ data: [{ id: "m" }] }),
    });
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    process.env["ACME_GATEWAY_KEY"] = "stored-key";
    touchedEnv.push("ACME_GATEWAY_KEY");
    await ctx.plugin(LlmPiAi, {
      providers: {
        "acme-gateway": {
          apiKeyEnv: "ACME_GATEWAY_KEY",
          api: "openai-completions",
          baseURL: server.url,
          headers: { "X-Company-Code": "private-tenant" },
          models: [{ id: "acme-large" }],
        },
        "plain-gateway": {
          apiKeyEnv: "ACME_GATEWAY_KEY",
          api: "openai-completions",
          baseURL: server.url,
          models: [{ id: "plain-large" }],
        },
      },
    });

    await ctx.llm.discoverModels("dsh-llm-provider-extended", {
      provider: "acme-gateway",
      baseURL: server.url,
    });
    // A key typed into the form is the one being tested — possibly the
    // replacement for the stored one — so it wins without resolving the
    // missing stored credential, while the route's headers still apply.
    Reflect.deleteProperty(process.env, "ACME_GATEWAY_KEY");
    await ctx.llm.discoverModels("dsh-llm-provider-extended", {
      provider: "acme-gateway",
      baseURL: server.url,
      apiKey: "typed",
    });
    // A route no profile declares yet is the create case: nothing is stored.
    await ctx.llm.discoverModels("dsh-llm-provider-extended", {
      provider: "not-declared-yet",
      baseURL: server.url,
    });
    // A configured route without deployment headers still contributes its
    // stored credential without inventing a header map.
    await ctx.llm.discoverModels("dsh-llm-provider-extended", {
      provider: "plain-gateway",
      baseURL: server.url,
      apiKey: "plain-typed",
    });

    expect(server.headers.map((headers) => headers.authorization)).toEqual([
      "Bearer stored-key",
      "Bearer typed",
      undefined,
      "Bearer plain-typed",
    ]);
    expect(server.headers.map((headers) => headers["x-company-code"])).toEqual([
      "private-tenant",
      "private-tenant",
      undefined,
      undefined,
    ]);
  });

  it("leaves a catalog route's credential unresolved, having never reached the network", async () => {
    // The catalog answers before any endpoint is asked, so a route whose
    // profile names a credential that is not set must still answer rather than
    // failing over a key the interrogation never needed.
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    Reflect.deleteProperty(process.env, "ABSENT_FOR_DISCOVERY");
    await ctx.plugin(LlmPiAi, {
      providers: { deepseek: { apiKeyEnv: "ABSENT_FOR_DISCOVERY" } },
    });

    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        provider: "deepseek",
      }),
    ).resolves.not.toHaveLength(0);
  });

  it("drops unusable rows rather than failing the whole listing", async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          { id: "good" },
          { id: "" },
          { name: "no id at all" },
          null,
          { id: "good" },
          { id: "zero-capacity", context_length: 0, max_tokens: -1 },
        ],
      }),
    });
    const ctx = await harness();

    expect(
      await ctx.llm.discoverModels("dsh-llm-provider-extended", {
        baseURL: server.url,
      }),
    ).toEqual([
      { id: "good", name: "good" },
      { id: "zero-capacity", name: "zero-capacity" },
    ]);
  });

  it("points at the credential for a rejected one, and only then", async () => {
    const ctx = await harness();

    for (const status of [401, 403]) {
      const refused = await listingServer({ status, body: '{"error":"nope"}' });
      await expect(
        ctx.llm.discoverModels("dsh-llm-provider-extended", {
          baseURL: refused.url,
          apiKey: "wrong",
        }),
      ).rejects.toThrow(new RegExp(`answered ${status}; check the API key`));
    }

    // A server fault is not a credential problem, so it must not send the user
    // off to re-check a key that is fine.
    const broken = await listingServer({
      status: 500,
      body: '{"error":"boom"}',
    });
    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        baseURL: broken.url,
        apiKey: "fine",
      }),
    ).rejects.toThrow(/answered 500$/);
  });

  it("reports a reply that is not a model listing", async () => {
    const server = await listingServer({ body: '{"models":[]}' });
    const ctx = await harness();

    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        baseURL: server.url,
      }),
    ).rejects.toThrow(/neither a "data" array nor a "models" object/);

    const broken = await listingServer({ body: "not json at all" });
    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        baseURL: broken.url,
      }),
    ).rejects.toThrow(/did not answer with JSON/);
  });

  it("refuses an oversized reply, whether its length is declared or streamed", async () => {
    const ctx = await harness();
    // Just over the four-megabyte ceiling, as one padded model row.
    const oversized = `{"data":[{"id":"m","pad":"${"x".repeat(4 * 1024 * 1024)}"}]}`;

    const declared = await listingServer({ body: oversized });
    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        baseURL: declared.url,
      }),
    ).rejects.toThrow(/answered with more than 4194304 bytes/);

    // A streamed reply declares no length, so the ceiling has to hold on the
    // body the harness actually read.
    const streamed = await listingServer({
      chunks: [
        '{"data":[{"id":"m","pad":"',
        "x".repeat(4 * 1024 * 1024),
        '"}]}',
      ],
    });
    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        baseURL: streamed.url,
      }),
    ).rejects.toThrow(/answered with more than 4194304 bytes/);
  });

  it("reports an unreachable endpoint instead of an empty catalog", async () => {
    const ctx = await harness();
    // Port 9 is the discard service: nothing accepts a connection there.
    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        baseURL: "http://127.0.0.1:9/v1",
      }),
    ).rejects.toMatchObject({ code: "DISCOVERY_FAILED" });
  });
});
