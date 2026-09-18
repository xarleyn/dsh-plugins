/** Unit tests for the LightRAG client: request shape, bounds, error mapping (SPEC §3, §4.4). */

import { describe, expect, it } from "vitest";

import { createLightRagClient } from "../src/client.js";
import { LIGHTRAG_DEFAULTS } from "../src/config.js";
import { caught } from "./client.helpers.js";
import {
  createFetchStub,
  jsonResponse,
  testClient,
  testConfig,
  textResponse,
} from "./helpers/lightrag.js";

describe("createLightRagClient", () => {
  it("issues requests through the runtime's fetch by default", async () => {
    // No fetch option: the client falls back to the runtime's implementation,
    // which every supported Node release provides.
    expect(() => createLightRagClient(testConfig())).not.toThrow();
    expect(() =>
      createLightRagClient(testConfig(), {
        fetch: {} as typeof globalThis.fetch,
      }),
    ).toThrow(TypeError);
  });

  it("builds every request against the configured origin", async () => {
    const { client, calls } = testClient(() => jsonResponse({ status: "ok" }));
    await client.health();
    expect(calls[0]?.url).toBe("http://127.0.0.1:9621/health");
    expect(calls[0]?.method).toBe("GET");
  });

  it("sends X-API-Key only when a key is configured", async () => {
    const anonymous = testClient(() => jsonResponse({}));
    await anonymous.client.health();
    expect(anonymous.calls[0]?.headers["x-api-key"]).toBeUndefined();

    const authenticated = testClient(
      () => jsonResponse({}),
      testConfig({ apiKey: "secret" }),
    );
    await authenticated.client.health();
    expect(authenticated.calls[0]?.headers["x-api-key"]).toBe("secret");
  });

  it("forwards the caller's cancellation signal", async () => {
    const controller = new AbortController();
    const { client, calls } = testClient(() => jsonResponse({}));
    await client.health({ signal: controller.signal });
    expect(calls[0]?.signal?.aborted).toBe(false);
    controller.abort();
    expect(calls[0]?.signal?.aborted).toBe(true);
  });
});

describe("error mapping", () => {
  it("maps HTTP statuses to the stable codes", async () => {
    const cases: ReadonlyArray<readonly [number, string]> = [
      [400, "invalid-argument"],
      [401, "unauthorized"],
      [403, "unauthorized"],
      [404, "not-found"],
      [413, "too-large"],
      [422, "invalid-argument"],
      [429, "rate-limited"],
      [500, "server-error"],
      [503, "server-error"],
      [418, "server-error"],
    ];
    for (const [status, code] of cases) {
      const { client } = testClient(() => jsonResponse({}, status));
      const error = await caught(() => client.health());
      expect(error.code, `HTTP ${status}`).toBe(code);
      expect(error.hint).toBeTruthy();
      expect(error.message).toContain("Hint:");
    }
  });

  it("carries the server's detail into the message", async () => {
    const { client } = testClient(() =>
      jsonResponse(
        { detail: "Input should be greater than or equal to 10" },
        422,
      ),
    );
    const error = await caught(() => client.health());
    expect(error.message).toContain("greater than or equal to 10");
  });

  it("folds a transport failure into unreachable", async () => {
    const { client } = testClient(() => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      });
    });
    const error = await caught(() => client.health());
    expect(error.code).toBe("unreachable");
    expect(error.message).toContain("http://127.0.0.1:9621");
    expect(error.message).toContain("ECONNREFUSED");
  });

  it("digs the useful reason out of a nested or aggregated cause", async () => {
    // Node reports one failure shape for a refused port and another for a
    // resolution failure; both bury the reason below a bare "fetch failed".
    const aggregate = testClient(() => {
      throw new TypeError("fetch failed", {
        cause: new AggregateError([
          Object.assign(new Error("getaddrinfo ENOTFOUND lightrag"), {
            code: "ENOTFOUND",
          }),
        ]),
      });
    });
    const unresolved = await caught(() => aggregate.client.health());
    expect(unresolved.message).toContain("getaddrinfo ENOTFOUND lightrag");
    expect(unresolved.message).toContain("ENOTFOUND");

    const shallow = testClient(() => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("bad port"), {
          code: "ERR_INVALID_PORT",
        }),
      });
    });
    const blocked = await caught(() => shallow.client.health());
    expect(blocked.message).toContain("bad port");
    expect(blocked.message).toContain("ERR_INVALID_PORT");
  });

  it("keeps a hint on every failure a deployment can meet", async () => {
    const { client } = testClient(() => jsonResponse({}, 404));
    const error = await caught(() => client.health());
    expect(error.hint).toContain("endpoint");
  });

  it("folds an elapsed budget into timeout", async () => {
    // The budget is clamped in the resolver, so build it directly.
    const stub = createFetchStub(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const client = createLightRagClient(
      { ...LIGHTRAG_DEFAULTS, timeoutMs: 20 },
      { fetch: stub.fetch },
    );
    const error = await caught(() => client.health());
    expect(error.code).toBe("timeout");
    expect(error.message).toContain("20 ms");
  });

  it("folds a caller abort into timeout", async () => {
    const controller = new AbortController();
    const stub = createFetchStub(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const client = createLightRagClient(LIGHTRAG_DEFAULTS, {
      fetch: stub.fetch,
    });
    const pending = caught(() => client.health({ signal: controller.signal }));
    controller.abort();
    const error = await pending;
    expect(error.code).toBe("timeout");
    expect(error.message).toContain("cancelled");
  });

  it("rejects a body that is not JSON", async () => {
    const { client } = testClient(() => textResponse("<html>nope</html>"));
    const error = await caught(() => client.health());
    expect(error.code).toBe("bad-response");
  });

  it("rejects JSON that is not this API", async () => {
    const { client } = testClient(() => jsonResponse(["not", "an", "object"]));
    const error = await caught(() => client.health());
    expect(error.code).toBe("bad-response");

    const answer = testClient(() => jsonResponse({ references: [] }));
    const missingResponse = await caught(() =>
      answer.client.query({
        question: "q",
        mode: "mix",
        topK: 5,
        withContent: false,
      }),
    );
    expect(missingResponse.code).toBe("bad-response");
  });

  it("refuses an oversized body instead of buffering it", async () => {
    const { client } = testClient(
      () => textResponse(JSON.stringify({ blob: "x".repeat(500) })),
      testConfig(),
      { maxResponseBytes: 64 },
    );
    const error = await caught(() => client.health());
    expect(error.code).toBe("too-large");
    expect(error.message).toContain("64 bytes");
  });
});
