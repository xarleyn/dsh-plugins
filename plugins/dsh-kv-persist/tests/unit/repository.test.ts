import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SnapshotRepository } from "../../src/snapshots/repository.js";
import { buildSnapshotIdentity } from "../../src/snapshots/fingerprint.js";
import { createManifest, parseManifest } from "../../src/snapshots/manifest.js";
import { KvMetadataIoError } from "../../src/errors.js";

function identity(sessionId = "session-a") {
  return buildSnapshotIdentity({
    sessionId,
    route: { provider: "local-qwen", model: "qwen-test" },
    baseURL: "http://127.0.0.1:8080",
    runtimeKey: null,
  });
}

const roots: string[] = [];

async function newRepository(): Promise<SnapshotRepository> {
  const root = await mkdtemp(join(tmpdir(), "dsh-kv-persist-repo-"));
  roots.push(root);
  return new SnapshotRepository(root);
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

describe("manifest schema (SPEC §14)", () => {
  it("round-trips through parse", () => {
    const manifest = createManifest({
      identity: identity(),
      slotId: 0,
      snapshotFilename: `${"a".repeat(64)}.bin`,
      sessionSeq: null,
      now: "2026-08-29T20:00:00.000Z",
    });
    expect(parseManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });

  it("rejects malformed documents with KV_MANIFEST_INVALID", () => {
    expect(() => parseManifest(null)).toThrowError(/JSON object/);
    expect(() => parseManifest({ schemaVersion: 2 })).toThrowError(/schemaVersion/);
    expect(() => parseManifest({ schemaVersion: 1 })).toThrowError(/sessionId/);
    const base = createManifest({
      identity: identity(),
      slotId: 0,
      snapshotFilename: `${"a".repeat(64)}.bin`,
      sessionSeq: null,
      now: "2026-08-29T20:00:00.000Z",
    });
    expect(() => parseManifest({ ...base, state: "weird" })).toThrowError(/state/);
    expect(() => parseManifest({ ...base, savedAt: undefined, createdAt: 5 })).toThrowError(/createdAt/);
  });
});

describe("snapshot repository (SPEC §39-§40)", () => {
  it("returns null for a missing manifest", async () => {
    const repository = await newRepository();
    await expect(repository.load(identity())).resolves.toBeNull();
    await expect(repository.findCompatible(identity())).resolves.toBeNull();
  });

  it("stores and finds a compatible manifest", async () => {
    const repository = await newRepository();
    await repository.put({
      identity: identity(),
      slotId: 0,
      sessionSeq: 341,
      tokens: 48_321,
      bytes: 2_384,
      now: "2026-08-29T20:00:00.000Z",
    });
    const found = await repository.findCompatible(identity());
    expect(found).not.toBeNull();
    expect(found?.sessionId).toBe("session-a");
    expect(found?.tokens).toBe(48_321);
    expect(found?.sessionSeq).toBe(341);
  });

  it("writes atomically: no temp leftovers, valid JSON only (SPEC §40)", async () => {
    const repository = await newRepository();
    await repository.put({
      identity: identity(),
      slotId: 0,
      sessionSeq: null,
      tokens: null,
      bytes: null,
      now: "2026-08-29T20:00:00.000Z",
    });
    const sessionsDir = join(repository.root, "instances", identity().serverInstanceKey, "sessions");
    const files = await readdir(sessionsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
    const text = await readFile(join(sessionsDir, files[0] as string), "utf8");
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("updates an existing manifest in place", async () => {
    const repository = await newRepository();
    await repository.put({
      identity: identity(),
      slotId: 0,
      sessionSeq: 1,
      tokens: null,
      bytes: null,
      now: "2026-08-29T20:00:00.000Z",
    });
    await repository.put({
      identity: identity(),
      slotId: 0,
      sessionSeq: 2,
      tokens: 100,
      bytes: 5_000,
      now: "2026-08-29T20:42:00.000Z",
    });
    const manifest = await repository.load(identity());
    expect(manifest?.sessionSeq).toBe(2);
    expect(manifest?.tokens).toBe(100);
    expect(manifest?.createdAt).toBe("2026-08-29T20:00:00.000Z");
    expect(manifest?.updatedAt).toBe("2026-08-29T20:42:00.000Z");
  });

  it("marks incompatible runtime keys as MODEL_FINGERPRINT_CHANGED (SPEC §31)", async () => {
    const repository = await newRepository();
    await repository.put({
      identity: identity(),
      slotId: 0,
      sessionSeq: null,
      tokens: null,
      bytes: null,
      now: "2026-08-29T20:00:00.000Z",
    });
    const changed = buildSnapshotIdentity({
      sessionId: "session-a",
      route: { provider: "local-qwen", model: "qwen-test" },
      baseURL: "http://127.0.0.1:8080",
      runtimeKey: "qwen38-v2",
    });
    await expect(repository.findCompatible(changed)).resolves.toBeNull();
    const stored = await repository.load(identity());
    expect(stored?.state).toBe("invalid");
    expect(stored?.invalidReason).toBe("MODEL_FINGERPRINT_CHANGED");
    // The data was not deleted — invalidation only flips state (SPEC §31).
    expect(stored?.snapshotFilename).toBeDefined();
  });

  it("counts known/valid/invalid manifests", async () => {
    const repository = await newRepository();
    await repository.put({
      identity: identity("session-a"),
      slotId: 0,
      sessionSeq: null,
      tokens: null,
      bytes: null,
      now: "2026-08-29T20:00:00.000Z",
    });
    await repository.put({
      identity: identity("session-b"),
      slotId: 0,
      sessionSeq: null,
      tokens: null,
      bytes: null,
      now: "2026-08-29T20:00:00.000Z",
    });
    await repository.markInvalid(identity("session-b"), "EXPLICIT", "2026-08-29T21:00:00.000Z");
    await expect(repository.counts()).resolves.toEqual({ known: 2, valid: 1, invalid: 1 });
  });

  it("invalidates and removes all manifests of a session across routes", async () => {
    const repository = await newRepository();
    const coderIdentity = buildSnapshotIdentity({
      sessionId: "session-a",
      route: { provider: "local-coder", model: "qwen-coder" },
      baseURL: "http://127.0.0.1:8080",
      runtimeKey: null,
    });
    for (const entry of [identity("session-a"), coderIdentity, identity("session-z")]) {
      await repository.put({
        identity: entry,
        slotId: 0,
        sessionSeq: null,
        tokens: null,
        bytes: null,
        now: "2026-08-29T20:00:00.000Z",
      });
    }
    await repository.invalidateSession(
      identity("session-a").sessionId,
      "EXPLICIT",
      "2026-08-29T21:00:00.000Z",
    );
    expect((await repository.load(identity("session-a")))?.state).toBe("invalid");
    expect((await repository.load(coderIdentity))?.state).toBe("invalid");
    expect((await repository.load(identity("session-z")))?.state).toBe("ready");

    await repository.removeSession("session-a");
    await expect(repository.load(identity("session-a"))).resolves.toBeNull();
    await expect(repository.load(coderIdentity)).resolves.toBeNull();
    await expect(repository.load(identity("session-z"))).resolves.not.toBeNull();
  });

  it("reports metadata IO problems as typed errors", async () => {
    const repository = await newRepository();
    await repository.put({
      identity: identity(),
      slotId: 0,
      sessionSeq: null,
      tokens: null,
      bytes: null,
      now: "2026-08-29T20:00:00.000Z",
    });
    const sessionsDir = join(repository.root, "instances", identity().serverInstanceKey, "sessions");
    const files = await readdir(sessionsDir);
    const manifestPath = join(sessionsDir, files[0] as string);
    await readFile(manifestPath, "utf8");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(manifestPath, "{not json", "utf8");
    await expect(repository.load(identity())).rejects.toBeInstanceOf(KvMetadataIoError);
  });
});
