import { fork } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCasRef, sha256Hex } from "../../src/cas/hash.js";
import type { CasObject } from "../../src/cas/types.js";
import {
  buildStore,
  cleanupTempRoots,
  tempRoot,
} from "../fixtures/store-fixtures.js";

const controls = vi.hoisted(() => ({
  noLinks: false,
  beforeLink: undefined as ((destination: string) => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: vi.fn(fs.readFile),
    link: async (from: string, to: string) => {
      await controls.beforeLink?.(to);
      if (controls.noLinks)
        throw Object.assign(new Error("no hard links"), { code: "ENOTSUP" });
      return fs.link(from, to);
    },
  };
});

const input = {
  payload: Buffer.from("shared text ".repeat(4000)),
  kind: "text",
  mediaType: "text/plain",
  encoding: "utf8",
} as const;
const hash = sha256Hex(input.payload);
const shard = ["sha256", hash.slice(0, 2), hash.slice(2, 4)];

afterEach(async () => {
  controls.noLinks = false;
  controls.beforeLink = undefined;
  await cleanupTempRoots();
});

describe("CAS publication across independent writers", () => {
  it.each([false, true])(
    "keeps one representation and its metadata (no hard links: %s)",
    async (noLinks) => {
      controls.noLinks = noLinks;
      const root = await tempRoot();
      const raw = buildStore(root),
        gzip = buildStore(root, "gzip");
      const [a, b] = await Promise.all([
        raw.put({ ...input, firstTool: "none" }),
        gzip.put({ ...input, firstTool: "gzip" }),
      ]);
      expect([a.reused, b.reused].sort()).toEqual([false, true]);
      expect(a.metadata.storageCodec).toBe(b.metadata.storageCodec);
      expect(a.metadata.firstTool).toBe(a.metadata.storageCodec);
      expect(b.metadata.firstTool).toBe(a.metadata.firstTool);
      const onDisk = await stat(join(root, "blobs", ...shard, hash + ".blob"));
      expect(a.metadata.storedSize).toBe(onDisk.size);
      expect(b.metadata.storedSize).toBe(onDisk.size);
      expect(Buffer.from((await gzip.read(hash)).bytes)).toEqual(input.payload);
    },
  );

  it("reuses a healthy large gzip blob without reading its payload again", async () => {
    const root = await tempRoot();
    const store = buildStore(root, "gzip");
    const large = { ...input, payload: Buffer.alloc(2 * 1024 * 1024, 65) };
    await store.put(large);
    vi.mocked(readFile).mockClear();
    expect((await buildStore(root).put(large)).reused).toBe(true);
    expect(
      vi
        .mocked(readFile)
        .mock.calls.filter(([path]) => String(path).endsWith(".blob")),
    ).toHaveLength(0);
  });

  it("publishes one readable representation from two separate Node processes", async () => {
    const root = await tempRoot();
    const workers = ["none", "gzip"].map((codec) =>
      fork(
        new URL("../fixtures/mixed-codec-writer.ts", import.meta.url),
        [root, codec],
        {
          cwd: fileURLToPath(new URL("../../", import.meta.url)),
          execArgv: ["--import", "@swc-node/register/esm-register"],
        },
      ),
    );
    try {
      await Promise.all(workers.map((worker) => once(worker, "message")));
      const finished = Promise.all(
        workers.map((worker) => once(worker, "message")),
      );
      for (const worker of workers) worker.send("write");
      const results = (await finished).map(([value]) => value as CasObject);
      expect(new Set(results.map((value) => value.ref)).size).toBe(1);
      expect(
        new Set(results.map((value) => value.metadata.storageCodec)).size,
      ).toBe(1);
      expect(results.map((value) => value.reused).sort()).toEqual([
        false,
        true,
      ]);
      const read = await buildStore(root).read(hash);
      expect(Buffer.from(read.bytes)).toEqual(input.payload);
    } finally {
      for (const worker of workers) worker.kill();
    }
  }, 30_000);

  it.each(["none", "gzip"] as const)(
    "repairs an existing mismatched %s blob from the original bytes",
    async (codec) => {
      const root = await tempRoot();
      const store = buildStore(root, codec);
      await store.put({ ...input, firstTool: "original" });
      const path = join(root, "blobs", ...shard, hash + ".blob");
      await writeFile(
        path,
        codec === "gzip" ? input.payload : gzipSync(input.payload),
      );
      const repaired = await buildStore(
        root,
        codec === "gzip" ? "none" : "gzip",
      ).put(input);
      expect(repaired.reused).toBe(false);
      expect(repaired.metadata).toMatchObject({
        size: input.payload.length,
        storedSize: (await stat(path)).size,
        storageCodec: codec,
        firstTool: "original",
      });
      expect(Buffer.from((await store.read(hash)).bytes)).toEqual(
        input.payload,
      );
      expect((await store.put(input)).reused).toBe(true);
    },
  );

  it("corrects legacy sizes when the stored contents already match", async () => {
    const root = await tempRoot();
    const store = buildStore(root, "gzip");
    const first = await store.put(input);
    const sidecar = join(root, "meta", ...shard, hash + ".json");
    await writeFile(
      sidecar,
      JSON.stringify({ ...first.metadata, size: 1, storedSize: 2 }),
    );
    const repaired = await store.put(input);
    expect(repaired.reused).toBe(true);
    expect(await store.stat(hash)).toMatchObject({
      size: input.payload.length,
      storedSize: first.metadata.storedSize,
    });
  });

  it("leaves another writer's committed blob intact on metadata failure", async () => {
    const root = await tempRoot();
    const pause = new EventEmitter();
    const reached = once(pause, "reached");
    controls.beforeLink = async (destination) => {
      if (!destination.endsWith(".json")) return;
      controls.beforeLink = undefined;
      const resume = once(pause, "resume");
      pause.emit("reached");
      await resume;
      throw Object.assign(new Error("metadata write failed"), { code: "EIO" });
    };
    const refused = buildStore(root).put(input);
    await reached;
    const winner = buildStore(root, "gzip");
    try {
      expect((await winner.put(input)).metadata.storageCodec).toBe("gzip");
    } finally {
      pause.emit("resume");
    }
    await expect(refused).rejects.toMatchObject({ code: "CAS_STORE_IO" });
    expect(Buffer.from((await winner.read(hash)).bytes)).toEqual(input.payload);
  });

  it("hides sidecar-only objects and finishes an interrupted publication", async () => {
    const root = await tempRoot();
    const winner = buildStore(root, "gzip");
    controls.beforeLink = async (destination) => {
      if (destination.endsWith(".blob"))
        throw Object.assign(new Error("unavailable"), { code: "EIO" });
    };
    await expect(winner.put(input)).rejects.toMatchObject({
      code: "CAS_STORE_IO",
    });
    expect(await winner.stat(hash)).toBeNull();
    expect(await winner.has(hash)).toBe(false);
    controls.beforeLink = undefined;
    expect((await buildStore(root).put(input)).metadata.storageCodec).toBe(
      "gzip",
    );
    expect(Buffer.from((await winner.read(hash)).bytes)).toEqual(input.payload);
  });

  it("finishes an elected sidecar left by a stopped writer without hard links", async () => {
    const prior = await buildStore(await tempRoot(), "gzip").put({
      ...input,
      firstTool: "original",
    });
    const root = await tempRoot();
    const pending = join(root, "tmp", hash + ".json.pending");
    await mkdir(pending, { recursive: true });
    await writeFile(
      join(pending, "cas-ab-0123456789abcdef.tmp"),
      JSON.stringify(prior.metadata),
    );
    controls.noLinks = true;
    const writer = buildStore(root);
    const resumed = await writer.put(input);
    expect(resumed.metadata).toMatchObject({
      storageCodec: "gzip",
      firstTool: "original",
    });
    expect(
      Buffer.from((await writer.read(parseCasRef(resumed.ref))).bytes),
    ).toEqual(input.payload);
  });

  it("removes only abandoned publication directories during the ordinary orphan sweep", async () => {
    const root = await tempRoot();
    const tmp = join(root, "tmp"),
      staged = "cas-ab-0123456789abcdef.tmp";
    const old = new Date(Date.now() - 2 * 3_600_000);
    for (const name of [
      staged + ".claim",
      hash + ".blob.pending",
      "unrelated.claim",
    ]) {
      const dir = join(tmp, name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, staged), "staged bytes");
      await utimes(dir, old, old);
    }
    expect(await buildStore(root).cleanTmpOrphans(Date.now())).toBe(2);
    expect(await readdir(tmp)).toEqual(["unrelated.claim"]);
    expect(await readFile(join(tmp, "unrelated.claim", staged), "utf8")).toBe(
      "staged bytes",
    );
  });
});
