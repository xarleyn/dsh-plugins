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

import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  claimForReplay,
  cleanStale,
  dequeue,
  enqueue,
  incrementRetry,
  listPending,
  releaseClaim,
} from "../src/openviking/pending-queue.js";
import {
  BASE,
  DAY_MS,
  dir,
  queueFiles,
  readEntry,
} from "./pending-queue.helpers.js";

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
