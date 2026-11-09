import { getEventListeners } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createRequestDeadline,
  readResponseBytes,
  withinDeadline,
} from "../src/http.js";

describe("HTTP request lifetime", () => {
  it("keeps the timeout active with a caller signal and cleans its listener", async () => {
    const caller = new AbortController();
    const deadline = createRequestDeadline({
      timeoutMs: 10,
      signal: caller.signal,
    });
    try {
      await expect(
        withinDeadline(new Promise(() => {}), deadline.signal),
      ).rejects.toMatchObject({ name: "TimeoutError" });
    } finally {
      deadline.dispose();
    }
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
  });

  it("preserves caller cancellation and observes late rejection", async () => {
    const caller = new AbortController();
    const reason = new Error("caller cancelled");
    caller.abort(reason);
    await expect(
      withinDeadline(Promise.reject(new Error("late")), caller.signal),
    ).rejects.toBe(reason);
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
  });

  it("counts bytes rather than characters and cancels oversized bodies", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("я".repeat(100)));
        },
        cancel,
      }),
    );
    const result = await readResponseBytes(response, {
      maxBytes: 101,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ bytes: 200, truncated: true });
    expect(result.data).toHaveLength(101);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it("settles a stalled body even when cancel never finishes", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ cancel }));
    const deadline = createRequestDeadline({ timeoutMs: 10 });
    try {
      await expect(
        readResponseBytes(response, { maxBytes: 100, signal: deadline.signal }),
      ).rejects.toMatchObject({ name: "TimeoutError" });
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body?.locked).toBe(false);
      expect(getEventListeners(deadline.signal, "abort")).toHaveLength(0);
    } finally {
      deadline.dispose();
    }
  });

  it("does not truncate an exactly full response", async () => {
    expect(
      await readResponseBytes(new Response("abcd"), {
        maxBytes: 4,
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ bytes: 4, truncated: false });
  });
});
