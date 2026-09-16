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

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimForReplay,
  cleanStale,
  dequeue,
  enqueue,
  incrementRetry,
  listPending,
  releaseClaim,
  replayPending,
  type PendingEntry,
  type PendingFetchJSON,
} from "../src/openviking/pending-queue.js";

/** Ordering base: far enough in the past to be explicit, far inside the TTL. */
const BASE = Date.now() - 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ENV_KEYS = [
  "OPENVIKING_PENDING_DIR",
  "OPENVIKING_PENDING_MAX_RETRIES",
  "OPENVIKING_PENDING_TTL_DAYS",
  "OPENVIKING_PENDING_REPLAY_LIMIT",
] as const;

const savedEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ov-pending-"));
  process.env.OPENVIKING_PENDING_DIR = dir;
  delete process.env.OPENVIKING_PENDING_MAX_RETRIES;
  delete process.env.OPENVIKING_PENDING_TTL_DAYS;
  delete process.env.OPENVIKING_PENDING_REPLAY_LIMIT;
});

afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dir, { recursive: true, force: true });
  dir = "";
});

/** Queue files as they are listed on disk (claimed `.processing` ones excluded). */
async function queueFiles(): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith(".json"));
}

async function readEntry(filename: string): Promise<PendingEntry> {
  return JSON.parse(
    await readFile(join(dir, filename), "utf-8"),
  ) as PendingEntry;
}

describe("enqueue", () => {
  it("writes exactly one file carrying the documented fields", async () => {
    const payload = { role: "user", content: "remember the deploy checklist" };
    const result = await enqueue("addMessage", "dsh-fields", payload, {
      createdAt: BASE,
    });

    expect(result.ok).toBe(true);
    expect(result.deduped).toBeUndefined();
    expect(result.dedupKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.path).toBe(`${result.dedupKey}_0.json`);

    expect(await readdir(dir)).toEqual([result.path]);
    expect(await readEntry(result.path!)).toEqual({
      type: "addMessage",
      sessionId: "dsh-fields",
      payload,
      createdAt: BASE,
      retries: 0,
      dedupKey: result.dedupKey,
    });
  });

  it("deduplicates an identical payload and keeps key order irrelevant", async () => {
    const first = await enqueue("addMessage", "dsh-dedup", { a: 1, b: 2 });
    const second = await enqueue("addMessage", "dsh-dedup", { a: 1, b: 2 });
    const reordered = await enqueue("addMessage", "dsh-dedup", { b: 2, a: 1 });

    expect(second.ok).toBe(true);
    expect(second.deduped).toBe(true);
    expect(second.dedupKey).toBe(first.dedupKey);
    expect(second.path).toBe(first.path);
    // The key is built from a key-sorted serialization, so key order is not identity.
    expect(reordered.deduped).toBe(true);
    expect(await queueFiles()).toHaveLength(1);
  });

  it("produces a distinct file per distinct payload and session", async () => {
    const one = await enqueue("addMessage", "dsh-distinct", { content: "one" });
    const two = await enqueue("addMessage", "dsh-distinct", { content: "two" });
    const otherSession = await enqueue("addMessage", "dsh-elsewhere", {
      content: "one",
    });
    const otherType = await enqueue("commitSession", "dsh-distinct", {
      content: "one",
    });

    for (const result of [two, otherSession, otherType]) {
      expect(result.deduped).toBeUndefined();
      expect(result.dedupKey).not.toBe(one.dedupKey);
    }
    expect(otherSession.dedupKey).not.toBe(otherType.dedupKey);
    expect(await queueFiles()).toHaveLength(4);
  });
});

describe("listPending", () => {
  it("returns entries in createdAt order and skips corrupt files", async () => {
    await enqueue(
      "addMessage",
      "dsh-order",
      { content: "later" },
      { createdAt: BASE + 2000 },
    );
    await enqueue(
      "addMessage",
      "dsh-order",
      { content: "earliest" },
      { createdAt: BASE },
    );
    await enqueue(
      "addMessage",
      "dsh-order",
      { content: "middle" },
      { createdAt: BASE + 1000 },
    );
    await writeFile(join(dir, "corrupt.json"), "{ this is not json", "utf-8");

    const items = await listPending();

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.entry.createdAt)).toEqual([
      BASE,
      BASE + 1000,
      BASE + 2000,
    ]);
    expect(items.map((item) => item.entry.payload)).toEqual([
      { content: "earliest" },
      { content: "middle" },
      { content: "later" },
    ]);
    expect(items.every((item) => item.filename.endsWith(".json"))).toBe(true);
  });
});

describe("claims", () => {
  it("claimForReplay renames to .processing and admits a single claimant", async () => {
    const queued = await enqueue("addMessage", "dsh-claim", {
      content: "claim me",
    });
    const filename = queued.path!;

    const claimed = await claimForReplay(filename);
    expect(claimed).toBe(filename.replace(/\.json$/, ".processing"));
    expect(await readdir(dir)).toEqual([claimed]);

    // The original name is gone, and a claimed file is not claimable again.
    expect(await claimForReplay(filename)).toBeNull();
    expect(await claimForReplay(claimed!)).toBeNull();
    // A claim is invisible to the queue until it is released.
    expect(await listPending()).toEqual([]);
  });

  it("releaseClaim restores the original filename without consuming a retry", async () => {
    const queued = await enqueue("addMessage", "dsh-release", {
      content: "hold me",
    });
    const filename = queued.path!;
    const claimed = await claimForReplay(filename);

    const restored = await releaseClaim(claimed!);
    expect(restored).toBe(filename);

    const items = await listPending();
    expect(items).toHaveLength(1);
    expect(items[0]!.filename).toBe(filename);
    expect(items[0]!.entry.retries).toBe(0);

    // Releasing twice, or releasing something that was never claimed, is a no-op.
    expect(await releaseClaim(claimed!)).toBeNull();
    expect(await releaseClaim(filename)).toBeNull();
  });

  it("dequeue removes an entry and reports nothing to remove afterwards", async () => {
    const queued = await enqueue("addMessage", "dsh-dequeue", {
      content: "remove me",
    });

    expect(await dequeue(queued.path!)).toBe(true);
    expect(await queueFiles()).toEqual([]);
    expect(await listPending()).toEqual([]);
    expect(await dequeue(queued.path!)).toBe(false);
  });
});

describe("incrementRetry", () => {
  it("renames to the next _N.json and mutates the entry's retry count", async () => {
    const queued = await enqueue("addMessage", "dsh-retry", {
      content: "flaky",
    });
    const [item] = await listPending();
    expect(item!.filename).toBe(queued.path);

    expect(await incrementRetry(item!.filename, item!.entry)).toBe(true);
    expect(item!.entry.retries).toBe(1);
    expect(await readdir(dir)).toEqual([
      queued.path!.replace("_0.json", "_1.json"),
    ]);

    const next = await listPending();
    expect(next[0]!.filename).toBe(queued.path!.replace("_0.json", "_1.json"));
    expect(next[0]!.entry.retries).toBe(1);
  });

  it("deletes the entry once OPENVIKING_PENDING_MAX_RETRIES is exceeded", async () => {
    process.env.OPENVIKING_PENDING_MAX_RETRIES = "1";
    await enqueue("addMessage", "dsh-exhaust", { content: "doomed" });

    const [first] = await listPending();
    expect(await incrementRetry(first!.filename, first!.entry)).toBe(true);
    expect(first!.entry.retries).toBe(1);

    const [second] = await listPending();
    // The count is bumped before the bound is checked, so the caller can log it.
    expect(await incrementRetry(second!.filename, second!.entry)).toBe(false);
    expect(second!.entry.retries).toBe(2);
    expect(await queueFiles()).toEqual([]);
    expect(await listPending()).toEqual([]);
  });

  it("keeps exactly OPENVIKING_PENDING_MAX_RETRIES retries by default", async () => {
    await enqueue("addMessage", "dsh-default-max", {
      content: "three strikes",
    });

    for (const expected of [1, 2, 3]) {
      const [item] = await listPending();
      expect(await incrementRetry(item!.filename, item!.entry)).toBe(true);
      expect((await listPending())[0]!.entry.retries).toBe(expected);
    }

    const [last] = await listPending();
    expect(await incrementRetry(last!.filename, last!.entry)).toBe(false);
    expect(await listPending()).toEqual([]);
  });
});

describe("cleanStale", () => {
  it("deletes entries past OPENVIKING_PENDING_TTL_DAYS and keeps fresh ones", async () => {
    process.env.OPENVIKING_PENDING_TTL_DAYS = "7";
    await enqueue(
      "addMessage",
      "dsh-ttl",
      { content: "stale" },
      { createdAt: Date.now() - 8 * DAY_MS },
    );
    await enqueue(
      "addMessage",
      "dsh-ttl",
      { content: "fresh" },
      { createdAt: Date.now() - 1000 },
    );

    expect(await cleanStale()).toBe(1);

    const items = await listPending();
    expect(items.map((item) => item.entry.payload)).toEqual([
      { content: "fresh" },
    ]);
  });
});

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
