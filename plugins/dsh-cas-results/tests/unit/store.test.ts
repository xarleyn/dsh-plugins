/** Unit tests for the filesystem CAS store: layout, reads, metadata (SPEC §14-§16, §26). */

import { afterEach, describe, expect, it } from "vitest";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { FilesystemCasStore } from "../../src/cas/filesystem-store.js";
import { CasError } from "../../src/cas/errors.js";
import { parseCasRef } from "../../src/cas/hash.js";
import { buildStore, cleanupTempRoots, tempRoot } from "../fixtures/store-fixtures.js";

const encoder = new TextEncoder();

afterEach(async () => {
  await cleanupTempRoots();
});

describe("FilesystemCasStore.put", () => {
  it("stores the blob and metadata under the sharded layout", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const payload = encoder.encode("hello cas");
    const object = await store.put({ payload, kind: "text", mediaType: "text/plain", encoding: "utf8", firstTool: "bash" });

    const hash = parseCasRef(object.ref);
    const blobPath = join(root, "blobs", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.blob`);
    const metaPath = join(root, "meta", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.json`);
    await expect(stat(blobPath)).resolves.toBeTruthy();
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    expect(meta.version).toBe(1);
    expect(meta.algorithm).toBe("sha256");
    expect(meta.hash).toBe(hash);
    expect(meta.size).toBe(payload.length);
    expect(meta.kind).toBe("text");
    expect(meta.mediaType).toBe("text/plain");
    expect(meta.encoding).toBe("utf8");
    expect(meta.firstTool).toBe("bash");
    expect(meta.hits).toBe(0);
    expect(object.reused).toBe(false);
  });

  it("with gzip codec records storedSize and storageCodec while identity stays logical", async () => {
    const root = await tempRoot();
    const store = buildStore(root, "gzip");
    const payload = encoder.encode("line\n".repeat(5_000));
    const object = await store.put({ payload, kind: "log", mediaType: "text/log", encoding: "utf8" });
    expect(object.metadata.storageCodec).toBe("gzip");
    expect(object.metadata.size).toBe(payload.length);
    expect(object.metadata.storedSize).toBeLessThan(payload.length);
    expect(await store.has(parseCasRef(object.ref))).toBe(true);
  });

  it("fails without writing anything when the store root is not creatable", async () => {
    const root = await tempRoot();
    const filePath = join(root, "occupied");
    await writeFile(filePath, "not a directory");
    const store = new FilesystemCasStore(filePath, { compression: "none" });
    await expect(
      store.put({ payload: encoder.encode("data"), kind: "text", mediaType: "text/plain", encoding: "utf8" }),
    ).rejects.toThrowError(CasError);
  });
});

describe("FilesystemCasStore.read", () => {
  it("returns the exact original bytes (SPEC AC2)", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const payload = encoder.encode("retrieved bytes === original UTF-8 bytes ✓\r\nCRLF preserved\r\n");
    const object = await store.put({ payload, kind: "text", mediaType: "text/plain", encoding: "utf8" });
    const read = await store.read(parseCasRef(object.ref));
    expect(Buffer.from(read.bytes).equals(Buffer.from(payload))).toBe(true);
    expect(read.totalSize).toBe(payload.length);
    expect(read.truncated).toBe(false);
    expect(read.offset).toBe(0);
  });

  it("returns bounded windows with truncation flags", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const payload = encoder.encode("0123456789".repeat(10));
    const object = await store.put({ payload, kind: "text", mediaType: "text/plain", encoding: "utf8" });
    const hash = parseCasRef(object.ref);

    const middle = await store.read(hash, { offset: 20, limit: 10 });
    expect(Buffer.from(middle.bytes).toString()).toBe("0123456789");
    expect(middle.truncated).toBe(true);

    const beyond = await store.read(hash, { offset: 1_000 });
    expect(beyond.bytes.length).toBe(0);
    expect(beyond.offset).toBe(payload.length);
    expect(beyond.truncated).toBe(false);
  });

  it("detects tampered payloads via integrity verification (SPEC §26)", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const object = await store.put({ payload: encoder.encode("integrity matters"), kind: "text", mediaType: "text/plain", encoding: "utf8" });
    const hash = parseCasRef(object.ref);
    const blobPath = join(root, "blobs", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.blob`);
    await writeFile(blobPath, "tampered payload!!");
    await expect(store.read(hash)).rejects.toThrowError(/integrity check/);
    // Verification can be skipped explicitly.
    await expect(store.read(hash, { verify: false })).resolves.toBeTruthy();
  });

  it("throws CAS_OBJECT_MISSING for unknown or GC-cleaned hashes", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const missing = "a".repeat(64);
    await expect(store.read(missing)).rejects.toThrowError(CasError);
    const error = await store.read(missing).catch((caught: unknown) => caught) as CasError;
    expect(error.code).toBe("CAS_OBJECT_MISSING");
  });

  it("refuses invalid hashes before touching the filesystem", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    await expect(store.has("nope")).rejects.toThrowError(/invalid SHA-256 hash/);
  });
});

describe("FilesystemCasStore.stat/touch", () => {
  it("reports null while the object is absent, metadata once stored", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const hash = "b".repeat(64);
    expect(await store.stat(hash)).toBeNull();
    const object = await store.put({ payload: encoder.encode("meta"), kind: "text", mediaType: "text/plain", encoding: "utf8" });
    const stored = await store.stat(parseCasRef(object.ref));
    expect(stored?.hash).toBe(parseCasRef(object.ref));
    expect(stored?.storageCodec).toBe("none");
  });

  it("reports null when metadata exists but the blob is gone", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const object = await store.put({ payload: encoder.encode("ghost"), kind: "text", mediaType: "text/plain", encoding: "utf8" });
    const hash = parseCasRef(object.ref);
    const { unlink } = await import("node:fs/promises");
    await unlink(join(root, "blobs", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.blob`));
    expect(await store.stat(hash)).toBeNull();
  });

  it("touch moves lastAccessedAt forward", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const object = await store.put({ payload: encoder.encode("touch"), kind: "text", mediaType: "text/plain", encoding: "utf8" });
    const hash = parseCasRef(object.ref);
    await store.touch(hash, new Date(2_000_000_000_000));
    const meta = await store.stat(hash);
    expect(meta?.lastAccessedAt).toBe(new Date(2_000_000_000_000).toISOString());
  });
});

describe("FilesystemCasStore.stats", () => {
  it("aggregates object counts and byte totals", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    await store.put({ payload: encoder.encode("a".repeat(100)), kind: "text", mediaType: "text/plain", encoding: "utf8" });
    await store.put({ payload: encoder.encode("b".repeat(300)), kind: "log", mediaType: "text/log", encoding: "utf8" });
    const stats = await store.stats();
    expect(stats.objects).toBe(2);
    expect(stats.logicalBytes).toBe(400);
    expect(stats.largestObjectBytes).toBe(300);
    expect(stats.hits).toBe(0);
  });
});

describe("FilesystemCasStore.search", () => {
  it("finds matches with context and honors caps", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const lines: string[] = [];
    for (let index = 0; index < 500; index += 1) {
      lines.push(index === 250 ? "AssertionError: boom" : `ok line ${index}`);
    }
    const object = await store.put({ payload: encoder.encode(lines.join("\n")), kind: "log", mediaType: "text/log", encoding: "utf8" });
    const hash = parseCasRef(object.ref);

    const outcome = await store.search(hash, { query: "assertionerror", contextLines: 2 });
    expect(outcome.totalMatches).toBe(1);
    expect(outcome.returnedMatches).toBe(1);
    expect(outcome.matches[0]?.line).toBe(251);
    expect(outcome.matches[0]?.text).toContain("AssertionError");
    expect(outcome.matches[0]?.before).toHaveLength(2);
    expect(outcome.matches[0]?.after).toHaveLength(2);

    const caseSensitive = await store.search(hash, { query: "AssertionError", caseSensitive: true });
    expect(caseSensitive.totalMatches).toBe(1);
    const absent = await store.search(hash, { query: "SegmentationFault" });
    expect(absent.totalMatches).toBe(0);
    expect(absent.matches).toHaveLength(0);
  });

  it("rejects empty queries", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const object = await store.put({ payload: encoder.encode("x"), kind: "text", mediaType: "text/plain", encoding: "utf8" });
    await expect(store.search(parseCasRef(object.ref), { query: "" })).rejects.toThrowError(/empty/);
  });
});
