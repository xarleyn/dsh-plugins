/** Unit tests for garbage collection and quotas (SPEC §24, AC11). */

import { afterEach, describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { FilesystemCasStore } from "../../src/cas/filesystem-store.js";
import { parseCasRef } from "../../src/cas/hash.js";
import { buildStore, cleanupTempRoots, tempRoot } from "../fixtures/store-fixtures.js";

const encoder = new TextEncoder();

afterEach(async () => {
  await cleanupTempRoots();
});

interface World {
  root: string;
  store: FilesystemCasStore;
}

async function world(): Promise<World> {
  const root = await tempRoot();
  return { root, store: buildStore(root) };
}

async function storeObject(store: FilesystemCasStore, content: string, lastAccessedAt: Date): Promise<string> {
  const object = await store.put({ payload: encoder.encode(content), kind: "text", mediaType: "text/plain", encoding: "utf8" });
  await store.touch(parseCasRef(object.ref), lastAccessedAt);
  return parseCasRef(object.ref);
}

describe("garbage collection", () => {
  it("deletes expired objects but protects fresh ones (SPEC §24)", async () => {
    const { store } = await world();
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    const expired = await storeObject(store, "expired payload", new Date(now - 40 * 24 * 3_600_000));
    const fresh = await storeObject(store, "fresh payload", new Date(now - 3_600_000));

    const outcome = await store.gc({ ttlMs: 30 * 24 * 3_600_000, minAgeMs: 24 * 3_600_000, maxBytes: 1 << 30, now });
    expect(outcome.deletedObjects).toBe(1);
    expect(await store.has(expired)).toBe(false);
    expect(await store.has(fresh)).toBe(true);
  });

  it("evicts oldest-accessed objects when the store exceeds its quota (SPEC AC11)", async () => {
    const { store } = await world();
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    const old = await storeObject(store, "x".repeat(800), new Date(now - 72 * 3_600_000));
    const young = await storeObject(store, "y".repeat(400), new Date(now - 1_000));

    const outcome = await store.gc({ ttlMs: 10 * 24 * 3_600_000, minAgeMs: 24 * 3_600_000, maxBytes: 1_000, now });
    expect(outcome.deletedObjects).toBeGreaterThanOrEqual(1);
    expect(await store.has(young)).toBe(true);
    expect(await store.stats().then((stats) => stats.logicalBytes)).toBeLessThanOrEqual(1_000);
    void old;
  });

  it("overrides minAge protection once routine GC cannot reach the quota", async () => {
    const { store } = await world();
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    // Both objects are younger than minAge; the quota is impossible to reach
    // without deleting them.
    await storeObject(store, "a".repeat(900), new Date(now - 1_000));
    await storeObject(store, "b".repeat(900), new Date(now - 2_000));
    await storeObject(store, "c".repeat(900), new Date(now - 3_000));

    const outcome = await store.gc({ ttlMs: 10 * 24 * 3_600_000, minAgeMs: 24 * 3_600_000, maxBytes: 2_000, now });
    expect(await store.stats().then((stats) => stats.logicalBytes)).toBeLessThanOrEqual(2_000);
    expect(outcome.deletedObjects).toBeGreaterThanOrEqual(1);
  });

  it("removes orphan metadata whose blob vanished", async () => {
    const { root, store } = await world();
    const object = await store.put({ payload: encoder.encode("orphan"), kind: "text", mediaType: "text/plain", encoding: "utf8" });
    const hash = parseCasRef(object.ref);
    const { unlink } = await import("node:fs/promises");
    await unlink(join(root, "blobs", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.blob`));
    const outcome = await store.gc({ ttlMs: 0, minAgeMs: 0, maxBytes: 1 << 30 });
    // The metadata entry is dropped either as expired (ttl 0) or as a ghost.
    expect(await store.stat(hash)).toBeNull();
    expect(outcome.scannedObjects).toBeGreaterThanOrEqual(1);
  });

  it("cleans orphan staging files older than an hour", async () => {
    const { root, store } = await world();
    const tmpDir = join(root, "tmp");
    await store.put({ payload: encoder.encode("warm the tmp dir"), kind: "text", mediaType: "text/plain", encoding: "utf8" });
    const { writeFile, utimes } = await import("node:fs/promises");
    const stale = join(tmpDir, "cas-stale.tmp");
    await writeFile(stale, "interrupted write");
    const old = new Date(Date.now() - 2 * 3_600_000);
    await utimes(stale, old, old);
    await writeFile(join(tmpDir, "cas-fresh.tmp"), "active write");

    const removed = await store.cleanTmpOrphans(Date.now());
    expect(removed).toBe(1);
    const remaining = await readdir(tmpDir);
    expect(remaining).toContain("cas-fresh.tmp");
    expect(remaining).not.toContain("cas-stale.tmp");
  });
});
