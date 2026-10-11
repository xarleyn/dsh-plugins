import type { Server } from "node:http";

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

/**
 * A stand-in provider that answers one scripted `GET /models`. `chunks` writes
 * without a declared length, which is how a real streamed reply arrives.
 */

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
  it.each([
    "azure-openai-responses",
    "openai-codex-responses",
    "google-generative-ai",
  ])(
    "says it cannot interrogate %s rather than guessing a shape",
    async (api) => {
      // Azure authenticates with an `api-key` header and an `api-version`
      // query despite its OpenAI lineage, and Codex uses OAuth; guessing at
      // either would report an auth failure as a provider with no models.
      const ctx = await harness();
      await expect(
        ctx.llm.discoverModels("dsh-llm-provider-extended", {
          baseURL: "https://gateway.example/v1",
          api,
        }),
      ).rejects.toMatchObject({ code: "DISCOVERY_UNSUPPORTED" });
    },
  );

  it("reports cancellation during the body read as an abort, not a raw reason", async () => {
    const ctx = await harness();
    const controller = new AbortController();
    const bodyRead = Promise.withResolvers<undefined>();
    vi.stubGlobal("fetch", async (_url: string | URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal === undefined || signal === null)
        throw new Error("expected a discovery signal");
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(stream) {
            bodyRead.resolve(undefined);
            return new Promise<void>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  stream.error(signal.reason);
                  resolve();
                },
                { once: true },
              );
            });
          },
        }),
      );
    });
    const probe = ctx.llm.discoverModels(
      "dsh-llm-provider-extended",
      {
        baseURL: "https://slow.example/v1",
      },
      controller.signal,
    );
    await bodyRead.promise;
    controller.abort("test cancellation");

    await expect(probe).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("honors caller cancellation", async () => {
    const ctx = await harness();
    const aborted = AbortSignal.abort("test cancellation");
    await expect(
      ctx.llm.discoverModels(
        "dsh-llm-provider-extended",
        {
          baseURL: "http://127.0.0.1:9/v1",
        },
        aborted,
      ),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("is offered for the namespace, and refuses one it does not serve", async () => {
    const ctx = await harness();

    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        provider: "openai",
      }),
    ).resolves.not.toHaveLength(0);
    await expect(
      ctx.llm.discoverModels("llm-deepseek", {
        baseURL: "https://api.deepseek.com",
      }),
    ).rejects.toMatchObject({ code: "NO_DISCOVERY" });
    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", { baseURL: "" }),
    ).rejects.toMatchObject({ code: "INVALID_DISCOVERY" });
  });

  it("withdraws the offer when the plugin unloads", async () => {
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    const fiber = await ctx.plugin(LlmPiAi, {});
    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        provider: "openai",
      }),
    ).resolves.not.toHaveLength(0);

    await fiber.dispose();

    await expect(
      ctx.llm.discoverModels("dsh-llm-provider-extended", {
        provider: "openai",
      }),
    ).rejects.toMatchObject({ code: "NO_DISCOVERY" });
  });
});
