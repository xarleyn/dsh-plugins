import type { Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

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

/**
 * A stand-in provider that answers one scripted `GET /models`. `chunks` writes
 * without a declared length, which is how a real streamed reply arrives.
 */

/** A bare dormant mount: discovery is offered whether or not a route exists. */

/**
 * Replies recorded from live endpoints on 2026-09-02, plus the reply
 * Anthropic's List Models reference documents. Each file keeps the reply's
 * top-level fields and entry objects verbatim; only a recorded entry list is
 * cut down to the named entries so the archive stays small.
 */

describe("probe key format", () => {
  it("reports an illegal probe key as a credential fault, not an unreachable endpoint", async () => {
    await expect(
      discoverModels({
        baseURL: "https://acme.test",
        api: "openai-completions",
        apiKey: "sk-\u{1F600}",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
  });

  it("reports a blank probe key as a credential fault too", async () => {
    // The Models page omits `apiKey` entirely for a cleared field rather than
    // sending '', so this pins the contract for every other caller: a supplied
    // key is judged, and only an absent one probes unauthenticated. '' means
    // "I have a key" and is answered as the empty key it is.
    await expect(
      discoverModels({
        baseURL: "https://acme.test",
        api: "openai-completions",
        apiKey: "",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
  });

  it("leaves a probe with no key unauthenticated", async () => {
    // The file's other cases capture headers through a real local HTTP server
    // (`listingServer`); this one has no route or stored key to resolve, so
    // the smallest real double is a `fetch` stub, scoped to this test and
    // unstubbed by the shared `afterEach` above.
    const requests: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await discoverModels({
      baseURL: "https://acme.test",
      api: "openai-completions",
    });

    const headers = new Headers(requests[0]?.headers);
    expect(headers.has("authorization")).toBe(false);
  });
});
