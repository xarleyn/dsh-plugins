/** Unit tests for storage-level deduplication (SPEC §13, AC3, AC4). */

import { afterEach, describe, expect, it } from "vitest";

import { parseCasRef } from "../../src/cas/hash.js";
import { buildStore, cleanupTempRoots, tempRoot } from "../fixtures/store-fixtures.js";
import type { FilesystemCasStore } from "../../src/cas/filesystem-store.js";

const encoder = new TextEncoder();

afterEach(async () => {
  await cleanupTempRoots();
});

describe("storage deduplication", () => {
  let root = "";
  let store = undefined as unknown as FilesystemCasStore;

  it("converges identical payloads onto one blob", async () => {
    root = await tempRoot();
    store = buildStore(root);
    const payload = encoder.encode("identical output ".repeat(1_000));
    const first = await store.put({ payload, kind: "log", mediaType: "text/log", encoding: "utf8", firstTool: "bash" });
    const second = await store.put({ payload, kind: "log", mediaType: "text/log", encoding: "utf8", firstTool: "bash" });

    expect(second.ref).toBe(first.ref);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.metadata.hits).toBe(first.metadata.hits + 1);
    const stats = await store.stats();
    expect(stats.objects).toBe(1);
    expect(stats.hits).toBe(1);
  });

  it("keeps different payloads in different blobs", async () => {
    const a = await store.put({ payload: encoder.encode("content A"), kind: "text", mediaType: "text/plain", encoding: "utf8" });
    const b = await store.put({ payload: encoder.encode("content B"), kind: "text", mediaType: "text/plain", encoding: "utf8" });
    expect(a.ref).not.toBe(b.ref);
    expect(await store.stats()).toMatchObject({ objects: 2 });
  });

  it("always yields the same stable reference for the same payload (SPEC AC4)", async () => {
    const payload = encoder.encode("stable");
    const refs = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      const object = await store.put({ payload, kind: "text", mediaType: "text/plain", encoding: "utf8" });
      refs.add(object.ref);
    }
    expect(refs.size).toBe(1);
    expect([...refs][0]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(parseCasRef([...refs][0] as string)).toHaveLength(64);
  });
});
