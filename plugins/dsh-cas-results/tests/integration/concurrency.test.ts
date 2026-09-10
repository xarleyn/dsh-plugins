/**
 * Integration tests for concurrent writers (SPEC §16, AC10).
 *
 * Acceptance target from SPEC §30 Phase 1: many concurrent puts of identical
 * data must converge on exactly one valid CAS blob.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { parseCasRef } from "../../src/cas/hash.js";
import { buildStore, cleanupTempRoots, makeLog, tempRoot } from "../fixtures/store-fixtures.js";

// The 100-writer race is CPU- and fs-scheduling sensitive; the default 5s
// budget trips when the whole workspace test suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

const encoder = new TextEncoder();

afterEach(async () => {
  await cleanupTempRoots();
});

describe("concurrent duplicate writes (SPEC AC10)", () => {
  it("stores exactly one valid blob for 100 concurrent identical puts", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const payload = encoder.encode(makeLog(64_000));

    const outcomes = await Promise.all(
      Array.from({ length: 100 }, () =>
        store.put({ payload, kind: "log", mediaType: "text/log", encoding: "utf8", firstTool: "bash" }),
      ),
    );

    const refs = new Set(outcomes.map((object) => object.ref));
    expect(refs.size).toBe(1);
    const hash = parseCasRef([...refs][0] as string);
    const blobDir = join(root, "blobs", "sha256", hash.slice(0, 2), hash.slice(2, 4));
    const blobs = await readdir(blobDir);
    expect(blobs).toEqual([`${hash}.blob`]);
    // The surviving blob is readable and passes verification.
    const read = await store.read(hash);
    expect(Buffer.from(read.bytes).equals(Buffer.from(payload))).toBe(true);
    const reused = outcomes.filter((object) => object.reused).length;
    expect(reused + outcomes.filter((object) => !object.reused).length).toBe(100);
    // No staging residue.
    const tmpDir = join(root, "tmp");
    expect(await readdir(tmpDir)).toEqual([]);
  });

  it("keeps distinct payloads intact under parallel writes", async () => {
    const root = await tempRoot();
    const store = buildStore(root);
    const payloads = Array.from({ length: 24 }, (_, index) => encoder.encode(`unique payload ${index}: ${makeLog(1_000)}`));
    const outcomes = await Promise.all(
      payloads.map((payload) => store.put({ payload, kind: "log", mediaType: "text/log", encoding: "utf8" })),
    );
    expect(new Set(outcomes.map((object) => object.ref)).size).toBe(24);
    for (let index = 0; index < payloads.length; index += 1) {
      const object = outcomes[index];
      const read = await store.read(parseCasRef(object?.ref as string));
      expect(Buffer.from(read.bytes).equals(Buffer.from(payloads[index] as Uint8Array))).toBe(true);
    }
  });
});
