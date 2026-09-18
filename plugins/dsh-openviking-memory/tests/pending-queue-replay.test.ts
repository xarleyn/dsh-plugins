/**
 * The offline pending queue, driven directly against a fresh directory.
 *
 * `src/openviking/pending-queue.ts` is a self-contained module whose location
 * and bounds all come from the environment, so nothing here goes through the
 * runtime: the ordering, claim and retry rules are observable on disk, and the
 * replay rules are observable through the injected `fetchJSON`.
 *
 * Timestamps are fixed offsets from one base so ordering assertions never race
 * the wall clock, while still staying inside the default seven-day TTL that
 * `replayPending`'s closing `cleanStale()` enforces.
 */

import { describe, expect, it, vi } from "vitest";

import {
  enqueue,
  listPending,
  replayPending,
  type PendingFetchJSON,
} from "../src/openviking/pending-queue.js";
import { BASE } from "./pending-queue.helpers.js";

describe("replayPending", () => {
  it("replays an addMessage entry and deletes it on success", async () => {
    await enqueue(
      "addMessage",
      "dsh-replay",
      { content: "replay me" },
      { createdAt: BASE },
    );
    const fetchJSON = vi.fn<PendingFetchJSON>(async () => ({ ok: true }));
    const log = vi.fn();

    const summary = await replayPending(fetchJSON, log);

    expect(summary).toEqual({
      replayed: 1,
      failed: 0,
      skipped: 0,
      deferred: 0,
    });
    expect(fetchJSON).toHaveBeenCalledTimes(1);
    const [path, init] = fetchJSON.mock.calls[0]!;
    expect(path).toBe("/api/v1/sessions/dsh-replay/messages");
    expect(init).toEqual({
      method: "POST",
      body: JSON.stringify({ content: "replay me" }),
    });
    expect(await listPending()).toEqual([]);
  });

  it("reports the documented summary and the replay-start / replay-done records", async () => {
    await enqueue(
      "addMessage",
      "dsh-summary",
      { content: "replay me" },
      { createdAt: BASE },
    );
    const fetchJSON = vi.fn<PendingFetchJSON>(async () => ({ ok: true }));
    const log = vi.fn();

    await replayPending(fetchJSON, log);

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]).toEqual([
      "pending-queue",
      { count: 1, replayLimit: 50, action: "replay-start" },
    ]);
    expect(log.mock.calls[1]).toEqual([
      "pending-queue",
      {
        action: "replay-done",
        replayed: 1,
        failed: 0,
        skipped: 0,
        deferred: 0,
        cleaned: 0,
      },
    ]);
  });

  it("returns the empty summary without touching the transport or the log", async () => {
    const fetchJSON = vi.fn<PendingFetchJSON>(async () => ({ ok: true }));
    const log = vi.fn();

    expect(await replayPending(fetchJSON, log)).toEqual({
      replayed: 0,
      failed: 0,
      skipped: 0,
      deferred: 0,
    });
    expect(fetchJSON).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("consumes a retry on a retryable failure and keeps the entry", async () => {
    await enqueue(
      "addMessage",
      "dsh-retry",
      { content: "flaky" },
      { createdAt: BASE },
    );
    const fetchJSON = vi.fn<PendingFetchJSON>(async () => ({
      ok: false,
      status: 503,
    }));
    const log = vi.fn();

    const summary = await replayPending(fetchJSON, log);

    expect(summary).toEqual({
      replayed: 0,
      failed: 1,
      skipped: 0,
      deferred: 0,
    });
    const items = await listPending();
    expect(items).toHaveLength(1);
    expect(items[0]!.entry.retries).toBe(1);
    expect(items[0]!.filename).toMatch(/_1\.json$/);
  });

  it("deletes a non-retryable failure", async () => {
    await enqueue(
      "addMessage",
      "dsh-rejected",
      { content: "too large" },
      { createdAt: BASE },
    );
    const fetchJSON = vi.fn<PendingFetchJSON>(async () => ({
      ok: false,
      status: 413,
    }));
    const log = vi.fn();

    const summary = await replayPending(fetchJSON, log);

    expect(summary).toEqual({
      replayed: 0,
      failed: 0,
      skipped: 1,
      deferred: 0,
    });
    expect(await listPending()).toEqual([]);
  });

  it("releases the claim instead of consuming a retry when consumeRetries is false", async () => {
    await enqueue(
      "addMessage",
      "dsh-drain",
      { content: "transient" },
      { createdAt: BASE },
    );
    const failing = vi.fn<PendingFetchJSON>(async () => ({
      ok: false,
      status: 503,
    }));
    const log = vi.fn();

    const first = await replayPending(failing, log, { consumeRetries: false });

    expect(first).toEqual({ replayed: 0, failed: 1, skipped: 0, deferred: 0 });
    const held = await listPending();
    expect(held).toHaveLength(1);
    expect(held[0]!.entry.retries).toBe(0);
    expect(held[0]!.filename).toMatch(/_0\.json$/);
    expect(
      log.mock.calls.map((call) => (call[1] as { action?: string }).action),
    ).toEqual(["replay-start", "replay-deferred", "replay-done"]);

    // The retry budget is still there for the session-start path to consume.
    const recovering = vi.fn<PendingFetchJSON>(async () => ({
      ok: false,
      status: 503,
    }));
    const second = await replayPending(recovering, vi.fn());
    expect(second.failed).toBe(1);
    const afterRetry = await listPending();
    expect(afterRetry[0]!.entry.retries).toBe(1);
    expect(afterRetry[0]!.filename).toMatch(/_1\.json$/);
  });
});
