import { readFile } from "node:fs/promises";

import { createServer } from "node:http";

import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Context } from "@deepseek-ai/cordis";

import LlmRuntime from "@deepseek-ai/dsh-llm";

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
const RECORDED_LISTINGS = [
  {
    name: "OpenRouter GET /api/v1/models",
    file: "openrouter-2026-09-02.json",
    api: "openai-completions",
    models: [
      {
        id: "anthropic/claude-fable-5.1",
        name: "Anthropic: Claude Fable 5.1",
        contextWindow: 1_000_000,
        maxTokens: 128_000,
      },
      // The router's own aggregate route reports no completion cap.
      {
        id: "openrouter/auto-beta",
        name: "Auto Router (Beta)",
        contextWindow: 2_000_000,
      },
      {
        id: "deepseek/deepseek-v4-flash",
        name: "DeepSeek: DeepSeek V4 Flash 0423",
        contextWindow: 1_048_576,
        maxTokens: 384_000,
      },
    ],
  },
  {
    name: "the models.dev anthropic provider object",
    file: "models-dev-anthropic-2026-09-02.json",
    api: "openai-completions",
    models: [
      {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        contextWindow: 1_000_000,
        maxTokens: 128_000,
      },
      {
        id: "claude-fable-5-1",
        name: "Claude Fable 5.1",
        contextWindow: 1_000_000,
        maxTokens: 128_000,
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5 (latest)",
        contextWindow: 200_000,
        maxTokens: 64_000,
      },
    ],
  },
  {
    name: "DeepSeek GET /models",
    file: "deepseek-2026-09-02.json",
    api: "openai-completions",
    models: [
      { id: "deepseek-v4-flash", name: "deepseek-v4-flash" },
      { id: "deepseek-v4-pro", name: "deepseek-v4-pro" },
      {
        id: "deepseek-v4-flash-vision-exp",
        name: "deepseek-v4-flash-vision-exp",
      },
    ],
  },
  {
    name: "Anthropic's documented GET /v1/models example",
    file: "anthropic-reference-example.json",
    api: "anthropic-messages",
    // The reference example fills both capacities with 0, which is not a
    // usable capacity, so the row carries the name alone.
    models: [{ id: "claude-opus-5", name: "Claude Opus 5" }],
  },
];
describe("recorded provider listings", () => {
  it.each(RECORDED_LISTINGS)(
    "reads $name as recorded",
    async ({ file, api, models }) => {
      const body = await readFile(
        new URL(`./fixtures/model-listings/${file}`, import.meta.url),
        "utf8",
      );
      const server = await listingServer({ body });
      const ctx = await harness();

      await expect(
        ctx.llm.discoverModels("dsh-llm-provider-extended", {
          baseURL: server.url,
          api,
        }),
      ).resolves.toEqual(models);
    },
  );
});
