import { createServer } from "node:http";

import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Context } from "@deepseek-ai/cordis";

import LlmRuntime from "@deepseek-ai/dsh-llm";

import * as LlmPiAi from "../../src/upstream/index.js";

import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

import { discoverModels } from "../../src/upstream/discovery.js";

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

describe("catalog-route model discovery", () => {
  it("includes the installed model input types for vision models", async () => {
    const ctx = await harness();
    const models = await ctx.llm.discoverModels("dsh-llm-provider-extended", {
      provider: "openai",
    });
    const installed = getBuiltinModels("openai").find(
      (model) => model.id === "gpt-6-astra",
    );
    expect(installed?.input).toContain("image");
    expect(models.find((model) => model.id === "gpt-6-astra")).toMatchObject({
      inputModalities: installed?.input,
    });
  });

  it("answers from the installed registry, with capacities and no network call", async () => {
    const server = await listingServer({
      body: JSON.stringify({ data: [{ id: "from-the-endpoint" }] }),
    });
    const ctx = await harness();

    const models = await ctx.llm.discoverModels("dsh-llm-provider-extended", {
      provider: "deepseek",
      baseURL: server.url,
    });

    // pi-ai's own registry is the authority for its own providers, and it
    // carries what a listing endpoint would not disclose.
    expect(models.map((model) => model.id).sort()).toEqual(
      getBuiltinModels("deepseek")
        .map((model) => model.id)
        .sort(),
    );
    expect(
      models.every(
        (model) => (model.contextWindow ?? 0) > 0 && (model.maxTokens ?? 0) > 0,
      ),
    ).toBe(true);
    expect(server.paths).toEqual([]);
  });

  it("needs no endpoint for a route the catalog describes", async () => {
    const ctx = await harness();
    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        provider: "deepseek",
      }),
    ).resolves.not.toHaveLength(0);
  });

  it("says where a route the catalog does not describe must get its models", async () => {
    const ctx = await harness();
    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        provider: "acme-gateway",
      }),
    ).rejects.toThrow(
      /ships no catalog for provider "acme-gateway".*set a baseURL/s,
    );
    // A form that cleared the field says the same thing as one that never had it.
    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        provider: "acme-gateway",
        baseURL: "",
      }),
    ).rejects.toThrow(/set a baseURL/);
    // The seam refuses a request naming neither, so the module's own guard for
    // that shape is only reachable by calling it directly.
    await expect(discoverModels({})).rejects.toThrow(/set a baseURL/);
  });
});
