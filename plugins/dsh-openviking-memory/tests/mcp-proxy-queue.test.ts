import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProxy,
  jsonResponse,
  rpcResult,
  writtenMessages,
} from "./mcp-proxy.helpers.js";

const request = (id: number | string) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/list",
});

function saturatedProxy() {
  // A transport may take time to unwind after abort. Its permit remains
  // occupied until the POST actually settles, including its response body.
  const finishes = Array.from({ length: 16 }, () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  });
  const h = createProxy({
    config: { timeoutMs: 100 },
    respond: async ({ body, signal }) => {
      const id = body.id;
      if (typeof id === "number" && finishes[id]) await finishes[id].promise;
      if (id === "slow")
        await new Promise<void>((resolve) =>
          signal!.addEventListener("abort", () => resolve(), { once: true }),
        );
      return jsonResponse(rpcResult(id, {}));
    },
  });
  const held = Promise.all(
    finishes.map((_, i) => h.proxy.handleMessage(request(i))),
  );
  const drain = async () => {
    finishes.forEach((finish) => finish.resolve());
    await vi.runAllTimersAsync();
    await held;
  };
  return { ...h, finishes, drain };
}

describe("proxy HTTP admission", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires a queued POST even when aborted holders are still unwinding", async () => {
    const h = saturatedProxy();
    await vi.advanceTimersByTimeAsync(10);
    expect(h.calls).toHaveLength(16);
    const waiter = h.proxy.handleMessage(request("waiting"));
    await vi.advanceTimersByTimeAsync(101);
    await waiter;
    expect(writtenMessages(h.writes)).toEqual([
      expect.objectContaining({
        id: "waiting",
        error: expect.objectContaining({
          code: -32004,
          data: expect.objectContaining({ phase: "queue", timeoutMs: 100 }),
        }),
      }),
    ]);
    await h.drain();
    expect(h.calls).toHaveLength(16);
    // All permits are reusable, even after simultaneous holder timeouts.
    const fresh = Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        h.proxy.handleMessage(request("next-" + i)),
      ),
    );
    await vi.runAllTimersAsync();
    await fresh;
    expect(h.calls).toHaveLength(32);
  });

  it("charges queue time to the same budget as the subsequent HTTP fetch", async () => {
    const h = saturatedProxy();
    await vi.advanceTimersByTimeAsync(0);
    const waiter = h.proxy.handleMessage(request("slow"));
    await vi.advanceTimersByTimeAsync(70);
    expect(h.calls).toHaveLength(16);
    h.finishes[0]!.resolve();
    await vi.advanceTimersByTimeAsync(29);
    expect(h.calls[16]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await waiter;
    expect(h.calls[16]?.signal?.aborted).toBe(true);
    expect(
      writtenMessages(h.writes).find((m) => m.id === "slow"),
    ).toMatchObject({
      error: { code: -32004, data: { phase: "upstream", timeoutMs: 100 } },
    });
    await h.drain();
  });

  it("hands a permit to the next live waiter once and drains the queue on close", async () => {
    const h = saturatedProxy();
    await vi.advanceTimersByTimeAsync(0);
    const cancel = h.proxy.handleMessage(request("cancel"));
    const keep = h.proxy.handleMessage(request("slow"));
    const tail = h.proxy.handleMessage(request("tail"));
    await vi.advanceTimersByTimeAsync(0);
    await h.proxy.handleMessage({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "cancel" },
    });
    await cancel;
    h.finishes[0]!.resolve();
    await vi.advanceTimersByTimeAsync(2);
    expect(h.calls.slice(16).map((c) => c.body.id)).toEqual(["slow"]);
    await h.proxy.closeSession();
    await Promise.all([keep, tail]);
    await h.drain();
    expect(h.calls.slice(16).map((c) => c.body.id)).toEqual(["slow"]);
    expect(writtenMessages(h.writes).map((m) => m.id)).toEqual([0]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
