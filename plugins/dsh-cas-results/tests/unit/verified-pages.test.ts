import { createReadStream } from "node:fs";
import { readdir, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCasRef, sha256Hex } from "../../src/cas/hash.js";
import {
  buildStore,
  cleanupTempRoots,
  tempRoot,
} from "../fixtures/store-fixtures.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, createReadStream: vi.fn(fs.createReadStream) };
});
vi.mock("../../src/cas/hash.js", async (original) => {
  const hash = await original<typeof import("../../src/cas/hash.js")>();
  return { ...hash, sha256Hex: vi.fn(hash.sha256Hex) };
});

const pageSize = 32 * 1024;
afterEach(async () => {
  vi.clearAllMocks();
  await cleanupTempRoots();
});

describe("verified CAS pages", () => {
  it("reads 256 pages with one full scan and only hashes the requested blocks afterwards", async () => {
    const store = buildStore(await tempRoot());
    const payload = Buffer.alloc(256 * pageSize, 0x61);
    const object = await store.put({
      payload,
      kind: "text",
      encoding: "utf8",
      mediaType: "text/plain",
    });
    const hash = parseCasRef(object.ref);
    vi.mocked(sha256Hex).mockClear();
    const [first, second] = await Promise.all(
      [0, pageSize].map((offset) =>
        store.read(hash, { offset, limit: pageSize }),
      ),
    );
    expect(first!.bytes).toEqual(second!.bytes);
    expect(vi.mocked(createReadStream)).toHaveBeenCalledTimes(1);
    for (
      let offset = 2 * pageSize;
      offset < payload.length;
      offset += pageSize
    ) {
      const page = await store.read(hash, { offset, limit: pageSize });
      expect(
        Buffer.compare(page.bytes, payload.subarray(offset, offset + pageSize)),
      ).toBe(0);
      expect(page.truncated).toBe(offset + pageSize < payload.length);
    }
    const scan = vi.mocked(createReadStream).mock.results[0]!.value;
    expect(scan.bytesRead).toBe(payload.length);
    // One block index plus one digest per returned block. The initial scan
    // also feeds the whole-object SHA-256 directly from the same stream.
    const blockBytes = vi
      .mocked(sha256Hex)
      .mock.calls.reduce((sum, [bytes]) => sum + bytes.length, 0);
    expect(blockBytes).toBe(2 * payload.length);
    expect(createReadStream).toHaveBeenCalledTimes(1);
  }, 30_000);

  it.each(["none", "gzip"] as const)(
    "invalidates a warm %s snapshot after a change outside the page",
    async (codec) => {
      const root = await tempRoot();
      const store = buildStore(root, codec);
      const payload = Buffer.alloc(2 * pageSize, 65);
      const object = await store.put({
        payload,
        kind: "text",
        encoding: "utf8",
        mediaType: "text/plain",
      });
      const hash = parseCasRef(object.ref);
      const page = await store.read(hash, { offset: 0, limit: 10 });
      page.bytes[0] = 42;
      expect((await store.read(hash, { offset: 0, limit: 10 })).bytes[0]).toBe(
        65,
      );
      const path = join(
        root,
        "blobs",
        "sha256",
        hash.slice(0, 2),
        hash.slice(2, 4),
        hash + ".blob",
      );
      payload[payload.length - 1] = 66;
      await writeFile(path, payload);
      await utimes(path, 60, 60);
      await expect(
        store.read(hash, { offset: 0, limit: 10 }),
      ).rejects.toMatchObject({ code: "CAS_INTEGRITY_FAILED" });
    },
  );

  it("inflates a large gzip only once, serves random ranges and releases the decoded file", async () => {
    const root = await tempRoot();
    const store = buildStore(root, "gzip");
    const payload = Buffer.alloc(8 * 1024 * 1024 + 19, 65);
    payload[payload.length - 3] = 66;
    const object = await store.put({
      payload,
      kind: "text",
      encoding: "utf8",
      mediaType: "text/plain",
    });
    const hash = parseCasRef(object.ref);
    for (const offset of [payload.length - 10, 3, pageSize - 5]) {
      const page = await store.read(hash, { offset, limit: 20 });
      expect(
        Buffer.compare(page.bytes, payload.subarray(offset, offset + 20)),
      ).toBe(0);
    }
    expect(createReadStream).toHaveBeenCalledTimes(1);
    const files = await readdir(join(root, "tmp"));
    const scratch = (
      await Promise.all(
        files.map(async (file) => {
          const path = join(root, "tmp", file);
          return (await stat(path).catch(() => undefined))?.size ===
            payload.length
            ? path
            : undefined;
        }),
      )
    ).find((path) => path !== undefined);
    expect(scratch).toBeDefined();
    store.dispose();
    await vi.waitFor(async () =>
      expect(await stat(scratch!).catch(() => undefined)).toBeUndefined(),
    );
  });

  it("releases a large gzip snapshot when disposal overtakes a pending read", async () => {
    const root = await tempRoot();
    const store = buildStore(root, "gzip");
    const object = await store.put({
      payload: Buffer.alloc(8 * 1024 * 1024 + 5, 65),
      kind: "text",
      encoding: "utf8",
      mediaType: "text/plain",
    });
    const pending = store.read(parseCasRef(object.ref), { limit: 5 });
    store.dispose();
    expect(Buffer.from((await pending).bytes).toString()).toBe("AAAAA");
    await vi.waitFor(async () =>
      expect(await readdir(join(root, "tmp"))).toEqual([]),
    );
  });
});
