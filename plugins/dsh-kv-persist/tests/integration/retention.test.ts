import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveKvPersistConfig } from "../../src/config.js";
import { snapshotGenerations } from "../../src/snapshots/naming.js";
import {
  buildIdentity,
  createHarness,
  deferred,
  run,
} from "../fixtures/harness.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function setup(mode: "dry-run" | "enforce" = "enforce") {
  const dir = await mkdtemp(join(tmpdir(), "kv-quota-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const h = await createHarness({
    retention: { maxBytes: 12, sharedDirectory: dir, mode },
    checkpoint: { idleMs: 0 },
  });
  cleanup.push(h.cleanup);
  const seed = async (id: string, day: number, sizes: number[]) => {
    const identity = buildIdentity(h, id);
    const names = snapshotGenerations(identity);
    for (const [i, size] of sizes.entries())
      await writeFile(join(dir, names[i]!), Buffer.alloc(size));
    await h.repository.put({
      identity,
      slotId: 0,
      sessionSeq: null,
      bytes: 1,
      tokens: null,
      now: new Date(Date.UTC(2020, 0, day)).toISOString(),
      snapshotFilename: names[sizes.length - 1],
    });
    return names[0].slice(0, 64);
  };
  return { h, dir, seed };
}

it("defaults to disabled and requires an explicit absolute mapping for a positive safe limit", () => {
  expect(resolveKvPersistConfig().retention).toBeNull();
  for (const maxBytes of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() =>
      resolveKvPersistConfig({
        retention: { maxBytes, sharedDirectory: tmpdir() },
      }),
    ).toThrow();
  }
  expect(() =>
    resolveKvPersistConfig({
      retention: { maxBytes: 10, sharedDirectory: "slots" },
    }),
  ).toThrow();
  expect(
    resolveKvPersistConfig({
      retention: { maxBytes: 10, sharedDirectory: tmpdir() },
    }).retention?.mode,
  ).toBe("dry-run");
});

it("previews actual sizes of both generations and prevents deletion in preview mode", async () => {
  const { h, dir, seed } = await setup("dry-run");
  const oldest = await seed("old", 1, [6, 4]);
  await seed("new", 2, [8]);
  await h.coordinator.invalidate("old");
  await writeFile(join(dir, "a".repeat(64) + ".bin"), Buffer.alloc(11));
  const before = await readdir(dir);
  const report = await h.coordinator.collectRetention();
  expect(report).toMatchObject({
    mode: "dry-run",
    beforeBytes: 18,
    remainingBytes: 18,
    candidates: [oldest],
    evicted: [],
    unattributedBytes: 11,
  });
  await expect(h.coordinator.collectRetention("enforce")).rejects.toThrow();
  expect(await readdir(dir)).toEqual(before);
});

it("evicts the oldest unused group once and preserves active and incoming sessions during a switch", async () => {
  const { h, dir, seed } = await setup();
  const old = await seed("old", 2, [4, 4]);
  const incoming = await seed("incoming", 1, [7]);
  await h.backend.saveSlot(0, incoming + ".bin");
  await run(h, "current");
  await seed("current", 3, [8]);
  await run(h, "incoming");
  expect(await h.repository.load(buildIdentity(h, "old"))).toBeNull();
  expect(await h.repository.load(buildIdentity(h, "incoming"))).not.toBeNull();
  expect(h.backend.residentSnapshot(0)).toBe(incoming + ".bin");
  expect(await readdir(dir)).not.toContain(old + ".b.bin");
  await h.coordinator.collectRetention("enforce");
  expect((await h.coordinator.collectRetention("enforce"))?.evicted).toEqual(
    [],
  );
});

it("finishes a detached partially deleted group after restart even below the limit", async () => {
  const { h, dir, seed } = await setup();
  const digest = await seed("partial", 1, [3, 4]);
  const meta = join(
    h.root,
    "instances",
    buildIdentity(h, "partial").serverInstanceKey,
    "sessions",
    digest,
  );
  await rename(meta + ".json", meta + ".gc");
  await unlink(join(dir, digest + ".bin"));
  expect(await h.repository.load(buildIdentity(h, "partial"))).toBeNull();
  expect((await h.coordinator.collectRetention())?.candidates).toEqual([
    digest,
  ]);
  expect(
    (await h.coordinator.collectRetention("enforce"))?.remainingBytes,
  ).toBe(0);
  expect(await readdir(dir)).toEqual([]);
  expect((await h.coordinator.collectRetention("enforce"))?.evicted).toEqual(
    [],
  );
});

it("refuses a mismatched manifest before making changes", async () => {
  const { h, dir, seed } = await setup();
  const digest = await seed("old", 1, [18]);
  const path = join(
    h.root,
    "instances",
    buildIdentity(h, "old").serverInstanceKey,
    "sessions",
    digest + ".json",
  );
  const manifest = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...manifest, sessionId: "other" }));
  await expect(h.coordinator.collectRetention("enforce")).rejects.toThrow(
    /identity/,
  );
  expect(await readdir(dir)).toEqual([digest + ".bin"]);
});

it("refuses a linked shared directory and preserves the physical store", async () => {
  const { h, dir, seed } = await setup();
  const digest = await seed("old", 1, [20]);
  const alias = join(h.root, "alias");
  await symlink(dir, alias, "junction");
  const { collectSnapshots } = await import("../../src/snapshots/retention.js");
  const policy = {
    sharedDirectory: alias,
    mode: "enforce" as const,
    maxBytes: 1,
  };
  await expect(
    collectSnapshots(
      h.root,
      buildIdentity(h, "old").serverInstanceKey,
      policy,
      new Set(),
    ),
  ).rejects.toThrow(/physical directory/);
  expect(await readdir(dir)).toEqual([digest + ".bin"]);
});

it("collects actual published generations through ordinary checkpoints", async () => {
  const { h, dir } = await setup();
  const save = h.backend.saveSlot.bind(h.backend);
  vi.spyOn(h.backend, "saveSlot").mockImplementation(async (slot, key) => {
    await writeFile(join(dir, key), Buffer.alloc(8));
    return save(slot, key);
  });
  for (const session of ["a", "b", "c"]) {
    await run(h, session);
    expect((await h.coordinator.saveNow(session)).kind).toBe("saved");
  }
  expect((await h.coordinator.collectRetention())?.beforeBytes).toBe(8);
  expect(await readdir(dir)).toEqual([
    snapshotGenerations(buildIdentity(h, "c"))[0],
  ]);
  expect(await h.repository.counts()).toEqual({
    known: 1,
    valid: 1,
    invalid: 0,
  });
  await h.coordinator.purge("c");
  const report = await h.coordinator.collectRetention("enforce");
  expect(report?.remainingBytes).toBe(0);
  expect(await readdir(dir)).toEqual([]);
});

it.each(["save", "restore"] as const)(
  "waits for an in-flight %s before collecting and protects its owner",
  async (operation) => {
    const { h, seed } = await setup();
    const old = await seed("old", 2, [10]);
    const active = await seed("active", 1, [10]);
    await h.backend.saveSlot(0, active + ".bin");
    const entered = deferred();
    const resume = deferred();
    const work = async () => {
      if (operation === "restore") {
        const restore = h.backend.restoreSlot.bind(h.backend);
        vi.spyOn(h.backend, "restoreSlot").mockImplementationOnce(
          async (slot, key) => {
            entered.resolve();
            await resume.promise;
            return restore(slot, key);
          },
        );
        await run(h, "active");
      } else {
        await run(h, "active");
        const save = h.backend.saveSlot.bind(h.backend);
        vi.spyOn(h.backend, "saveSlot").mockImplementationOnce(
          async (slot, key) => {
            entered.resolve();
            await resume.promise;
            return save(slot, key);
          },
        );
        await h.coordinator.saveNow("active");
      }
    };
    const activeWork = work();
    await entered.promise;
    let completed = false;
    const collecting = h.coordinator.collectRetention("enforce").then(() => {
      completed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(completed).toBe(false);
    resume.resolve();
    await Promise.all([activeWork, collecting]);
    expect(await h.repository.load(buildIdentity(h, "active"))).not.toBeNull();
    expect(await h.repository.load(buildIdentity(h, "old"))).toBeNull();
    expect(old).not.toBe(active);
  },
);
