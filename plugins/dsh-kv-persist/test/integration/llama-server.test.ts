/**
 * Opt-in integration test against a real llama-server (SPEC §78).
 *
 * Runs only when DSH_KV_TEST_LLAMA_URL is set, e.g.:
 *
 *   DSH_KV_TEST_LLAMA_URL=http://127.0.0.1:8080 pnpm vitest run test/integration/llama-server.test.ts
 *
 * The ordinary CI pipeline never requires a GPU or a running server.
 */

import { describe, expect, it } from "vitest";
import { LlamaCppBackend } from "../../src/backends/llama-cpp/backend.js";

const llamaUrl = process.env.DSH_KV_TEST_LLAMA_URL;

describe.skipIf(llamaUrl === undefined)("llama-server integration (SPEC §78)", () => {
  it("probes the slots endpoint and finds the configured slot", async () => {
    const backend = new LlamaCppBackend(
      { baseURL: llamaUrl as string, apiKey: null, requestTimeoutMs: 5_000 },
      0,
    );
    const capabilities = await backend.probe();
    expect(capabilities.kind).toBe("llama.cpp");
    expect(capabilities.slotsAvailable).toBe(true);
    expect(capabilities.slotIds).toContain(0);
  }, 10_000);
});
