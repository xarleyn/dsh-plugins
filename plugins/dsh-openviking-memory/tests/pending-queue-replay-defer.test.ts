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

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  enqueue,
  listPending,
  replayPending,
  type PendingFetchJSON,
} from "../src/openviking/pending-queue.js";
import { BASE, dir, queueFiles, readEntry } from "./pending-queue.helpers.js";

describe("replayPending", () => {
  it("stops at the first retryable addMessage failure and defers the remainder in order", async () => {
    await enqueue(
      "addMessage",
      "dsh-stop",
      { content: "first" },
      { createdAt: BASE },
    );
    await enqueue(
      "addMessage",
      "dsh-stop",
      { content: "second" },
      { createdAt: BASE + 1000 },
    );
    await enqueue(
      "addMessage",
      "dsh-stop",
      { content: "third" },
      { createdAt: BASE + 2000 },
    );
    const fetchJSON = vi.fn<PendingFetchJSON>(async () => ({
      ok: false,
      status: 503,
    }));
    const log = vi.fn();

    const summary = await replayPending(fetchJSON, log, {
      consumeRetries: false,
    });

    expect(summary).toEqual({
      replayed: 0,
      failed: 1,
      skipped: 0,
      deferred: 2,
    });
    expect(fetchJSON).toHaveBeenCalledTimes(1);
    const pending = await listPending();
    expect(pending.map((item) => item.entry.payload)).toEqual([
      { content: "first" },
      { content: "second" },
      { content: "third" },
    ]);
    expect(pending.map((item) => item.entry.retries)).toEqual([0, 0, 0]);
    expect(pending.map((item) => item.entry.createdAt)).toEqual([
      BASE,
      BASE + 1000,
      BASE + 2000,
    ]);
  });

  it("keeps going after a failed commitSession", async () => {
    await enqueue(
      "commitSession",
      "dsh-commit",
      { keep_recent_count: 10 },
      { createdAt: BASE },
    );
    await enqueue(
      "addMessage",
      "dsh-commit",
      { content: "after the commit" },
      { createdAt: BASE + 1000 },
    );
    const fetchJSON = vi.fn<PendingFetchJSON>(async (path, init) => {
      if (init?.method === "POST" && path.endsWith("/commit"))
        return { ok: false, status: 503 };
      return { ok: true };
    });

    const summary = await replayPending(fetchJSON, vi.fn());

    expect(summary).toEqual({
      replayed: 1,
      failed: 1,
      skipped: 0,
      deferred: 0,
    });
    expect(fetchJSON).toHaveBeenCalledTimes(2);
    expect(fetchJSON.mock.calls.map((call) => call[0])).toEqual([
      "/api/v1/sessions/dsh-commit/commit",
      "/api/v1/sessions/dsh-commit/messages",
    ]);
    const pending = await listPending();
    expect(pending.map((item) => item.entry.type)).toEqual(["commitSession"]);
  });

  it("honours OPENVIKING_PENDING_REPLAY_LIMIT and defers the rest", async () => {
    process.env.OPENVIKING_PENDING_REPLAY_LIMIT = "1";
    await enqueue(
      "addMessage",
      "dsh-limit",
      { content: "replay me" },
      { createdAt: BASE },
    );
    await enqueue(
      "addMessage",
      "dsh-limit",
      { content: "defer me" },
      { createdAt: BASE + 1000 },
    );
    const fetchJSON = vi.fn<PendingFetchJSON>(async () => ({ ok: true }));

    const summary = await replayPending(fetchJSON, vi.fn());

    expect(summary).toEqual({
      replayed: 1,
      failed: 0,
      skipped: 0,
      deferred: 1,
    });
    expect(fetchJSON).toHaveBeenCalledTimes(1);
    const pending = await listPending();
    expect(pending.map((item) => item.entry.payload)).toEqual([
      { content: "defer me" },
    ]);
  });

  it("skips (and deletes) an entry whose retry budget is already exhausted", async () => {
    process.env.OPENVIKING_PENDING_MAX_RETRIES = "0";
    await enqueue(
      "addMessage",
      "dsh-exhausted",
      { content: "doomed" },
      { createdAt: BASE },
    );
    const fetchJSON = vi.fn<PendingFetchJSON>(async () => ({ ok: true }));

    const summary = await replayPending(fetchJSON, vi.fn(), {
      consumeRetries: false,
    });

    expect(summary).toEqual({
      replayed: 0,
      failed: 0,
      skipped: 1,
      deferred: 0,
    });
    expect(fetchJSON).not.toHaveBeenCalled();
    expect(await listPending()).toEqual([]);
  });

  it("deletes an entry of an unknown type without sending it", async () => {
    const queued = await enqueue(
      "addMessage",
      "dsh-unknown",
      { content: "who am i" },
      { createdAt: BASE },
    );
    await writeFile(
      join(dir, queued.path!),
      JSON.stringify({
        ...(await readEntry(queued.path!)),
        type: "somethingElse",
      }),
      "utf-8",
    );
    const fetchJSON = vi.fn<PendingFetchJSON>(async () => ({ ok: true }));

    const summary = await replayPending(fetchJSON, vi.fn());

    expect(summary).toEqual({
      replayed: 0,
      failed: 0,
      skipped: 1,
      deferred: 0,
    });
    expect(fetchJSON).not.toHaveBeenCalled();
    expect(await listPending()).toEqual([]);
  });

  it("treats a rejecting transport as a retryable failure", async () => {
    await enqueue(
      "addMessage",
      "dsh-throw",
      { content: "boom" },
      { createdAt: BASE },
    );
    const fetchJSON = vi.fn<PendingFetchJSON>(async () => {
      throw new Error("socket hang up");
    });

    const summary = await replayPending(fetchJSON, vi.fn());

    expect(summary).toEqual({
      replayed: 0,
      failed: 1,
      skipped: 0,
      deferred: 0,
    });
    expect((await listPending())[0]!.entry.retries).toBe(1);
  });
});

describe("queue order across both kinds", () => {
  it("replays an interleaved backlog in createdAt order and empties the queue", async () => {
    await enqueue(
      "addMessage",
      "dsh-round",
      { role: "user", content: "one" },
      { createdAt: BASE },
    );
    await enqueue(
      "commitSession",
      "dsh-round",
      { keep_recent_count: 10 },
      { createdAt: BASE + 1000 },
    );
    await enqueue(
      "addMessage",
      "dsh-round",
      { role: "assistant", content: "two" },
      { createdAt: BASE + 2000 },
    );
    const fetchJSON = vi.fn<PendingFetchJSON>(async () => ({
      ok: true,
      result: { trace_id: "trace-1" },
    }));
    const log = vi.fn();

    const summary = await replayPending(fetchJSON, log);

    expect(summary).toEqual({
      replayed: 3,
      failed: 0,
      skipped: 0,
      deferred: 0,
    });
    expect(fetchJSON.mock.calls.map((call) => call[0])).toEqual([
      "/api/v1/sessions/dsh-round/messages",
      "/api/v1/sessions/dsh-round/commit",
      "/api/v1/sessions/dsh-round/messages",
    ]);
    // A commit replay reports its own record, between the two message replays.
    expect(
      log.mock.calls.map((call) => (call[1] as { action?: string }).action),
    ).toEqual(["replay-start", "commit-replay", "replay-done"]);
    expect(await queueFiles()).toEqual([]);
  });
});
