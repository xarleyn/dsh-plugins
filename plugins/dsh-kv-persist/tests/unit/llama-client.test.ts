import { describe, expect, it } from "vitest";
import {
  KvBackendUnavailableError,
  KvEraseFailedError,
  KvRestoreFailedError,
  KvSaveFailedError,
} from "../../src/errors.js";
import { LlamaCppClient } from "../../src/backends/llama-cpp/client.js";

function response(body: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

function client(fetchImpl: typeof fetch, requestTimeoutMs = 100): LlamaCppClient {
  return new LlamaCppClient({
    baseURL: "http://llama.test",
    apiKey: null,
    requestTimeoutMs,
    fetchImpl,
  });
}

describe("LlamaCppClient response validation", () => {
  it.each([
    ["array", "[]"],
    ["null", "null"],
    ["number", "1"],
    ["string", '"ok"'],
    ["empty body", ""],
    ["malformed JSON", "{"],
    ["success=false", '{"success":false}'],
    ["missing success", '{}'],
  ])("rejects an invalid save response: %s", async (_name, body) => {
    await expect(client(response(body)).saveSlot(0, "snapshot.bin")).rejects.toBeInstanceOf(
      KvSaveFailedError,
    );
  });

  it("accepts a save object with explicit success=true", async () => {
    await expect(
      client(response('{"success":true}')).saveSlot(0, "snapshot.bin"),
    ).resolves.toEqual({ success: true });
  });

  it("rejects a non-200 save response", async () => {
    await expect(client(response('{"success":true}', 503)).saveSlot(0, "snapshot.bin"))
      .rejects.toBeInstanceOf(KvSaveFailedError);
  });

  it.each([
    ["array", "[]"],
    ["null", "null"],
    ["number", "1"],
    ["string", '"ok"'],
    ["empty body", ""],
    ["malformed JSON", "{"],
    ["success=false", '{"success":false}'],
    ["non-boolean success", '{"success":"yes"}'],
    ["invalid n_restored", '{"n_restored":"42"}'],
  ])("rejects an invalid restore response: %s", async (_name, body) => {
    await expect(client(response(body)).restoreSlot(0, "snapshot.bin")).rejects.toBeInstanceOf(
      KvRestoreFailedError,
    );
  });

  it.each([
    ['{"n_restored":42}', 42],
    ['{"success":true,"nRestored":7}', 7],
    ["{}", null],
  ])("accepts a valid restore object", async (body, nRestored) => {
    await expect(client(response(body)).restoreSlot(0, "snapshot.bin")).resolves.toEqual({
      success: true,
      nRestored,
    });
  });

  it("rejects a non-200 restore response", async () => {
    await expect(client(response("{}", 500)).restoreSlot(0, "snapshot.bin"))
      .rejects.toBeInstanceOf(KvRestoreFailedError);
  });

  it.each([
    ["array", "[]"],
    ["null", "null"],
    ["number", "1"],
    ["string", '"ok"'],
    ["empty body", ""],
    ["malformed JSON", "{"],
    ["success=false", '{"success":false}'],
    ["non-boolean success", '{"success":"yes"}'],
    ["missing result fields", "{}"],
  ])("rejects an invalid erase response: %s", async (_name, body) => {
    await expect(client(response(body)).eraseSlot(0)).rejects.toBeInstanceOf(KvEraseFailedError);
  });

  it.each(['{"id_slot":0,"n_erased":42}', '{"success":true}'])(
    "accepts a valid erase object",
    async (body) => {
      await expect(client(response(body)).eraseSlot(0)).resolves.toEqual({ success: true });
    },
  );

  it("rejects a non-200 erase response", async () => {
    await expect(client(response('{"success":true}', 500)).eraseSlot(0))
      .rejects.toBeInstanceOf(KvEraseFailedError);
  });

  it.each([
    ["null", "null"],
    ["number", "1"],
    ["string", '"ok"'],
    ["empty body", ""],
    ["malformed JSON", "{"],
    ["missing slots", "{}"],
  ])("rejects an invalid slots response: %s", async (_name, body) => {
    await expect(client(response(body)).inspectSlots()).rejects.toBeInstanceOf(
      KvBackendUnavailableError,
    );
  });

  it.each([
    ["[]", []],
    ['[{"id":0},1]', [{ id: 0 }, { id: 1 }]],
    ['{"slots":[{"id":2}]}', [{ id: 2 }]],
  ])("accepts a supported slots response", async (body, slots) => {
    await expect(client(response(body)).inspectSlots()).resolves.toEqual({ slots });
  });

  it("rejects a non-200 slots response", async () => {
    await expect(client(response("[]", 503)).inspectSlots()).rejects.toBeInstanceOf(
      KvBackendUnavailableError,
    );
  });
});

describe("LlamaCppClient transport diagnostics", () => {
  it("distinguishes an internal timeout and preserves its cause", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const fetchImpl = ((...args: Parameters<typeof fetch>) => {
      const init = args[1];
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(abortError), { once: true });
      });
    }) as typeof fetch;

    const request = client(fetchImpl, 5).inspectSlots();
    await expect(request).rejects.toThrowError("request timed out after 5ms");
    await request.catch((error: unknown) => {
      expect(error).toBeInstanceOf(KvBackendUnavailableError);
      expect((error as Error).cause).toBe(abortError);
    });
  });

  it("reports a connection failure as unreachable and preserves its cause", async () => {
    const connectionError = new Error("connection refused");
    const fetchImpl = (async () => {
      throw connectionError;
    }) as typeof fetch;
    const request = client(fetchImpl).inspectSlots();

    await expect(request).rejects.toThrowError(/server .* is unreachable: connection refused/);
    await request.catch((error: unknown) => {
      expect(error).toBeInstanceOf(KvBackendUnavailableError);
      expect((error as Error).cause).toBe(connectionError);
    });
  });
});
