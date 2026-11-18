// Run against the built package on a disposable Linux tmpfs (see README).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildSnapshotIdentity } from "../../lib/snapshots/fingerprint.js";
import { snapshotGenerations } from "../../lib/snapshots/naming.js";
import { SnapshotRepository } from "../../lib/snapshots/repository.js";
import { collectSnapshots } from "../../lib/snapshots/retention.js";

test("reclaim an unused pair after an actual ENOSPC and retry the unpublished save", async () => {
  const mount = "/quota";
  const fs = await statfs(mount);
  assert.equal(fs.type, 0x01021994, "requires disposable tmpfs");
  assert.equal(fs.blocks * fs.bsize, 1024 * 1024, "requires a 1 MiB mount");
  const dir = await mkdtemp(join(mount, "snapshots-"));
  try {
    const repository = new SnapshotRepository(join(dir, "meta"));
    const id = (sessionId) =>
      buildSnapshotIdentity({
        sessionId,
        baseURL: "http://localhost",
        runtimeKey: null,
        route: { provider: "test", model: "test" },
      });
    const owner = id("active");
    const other = id("unused");
    const [first, next] = snapshotGenerations(owner);
    const [unused] = snapshotGenerations(other);
    const publish = (identity, filename) =>
      repository.put({
        identity,
        snapshotFilename: filename,
        slotId: 0,
        sessionSeq: null,
        tokens: null,
        bytes: null,
        now: new Date().toISOString(),
      });
    const old = Buffer.alloc(128 * 1024, 1);
    const updated = Buffer.alloc(512 * 1024, 2);
    await writeFile(join(dir, first), old);
    const committed = await publish(owner, first);
    await writeFile(join(dir, unused), Buffer.alloc(640 * 1024));
    await publish(other, unused);
    await assert.rejects(writeFile(join(dir, next), updated), {
      code: "ENOSPC",
    });
    assert.deepEqual(await repository.findCompatible(owner), committed);
    assert.deepEqual(await readFile(join(dir, first)), old);
    const policy = {
      sharedDirectory: dir,
      maxBytes: 700 * 1024,
      mode: "enforce",
    };
    const collect = () =>
      collectSnapshots(
        repository.root,
        owner.serverInstanceKey,
        policy,
        new Set([owner.sessionId]),
      );
    assert.deepEqual((await collect()).evicted, [unused.slice(0, 64)]);
    assert.equal(await repository.load(other), null);
    await writeFile(join(dir, next), updated);
    await publish(owner, next);
    assert.equal(
      (await repository.findCompatible(owner)).snapshotFilename,
      next,
    );
    assert.deepEqual(await readFile(join(dir, next)), updated);
    assert.deepEqual((await collect()).evicted, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
