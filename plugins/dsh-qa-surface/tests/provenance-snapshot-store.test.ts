import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_QA_PROVENANCE_RETENTION,
  FileQaProvenanceSnapshotStore,
  type QaProvenanceRetention,
} from "../src/provenance/snapshot-store.js";
import type { QaTurnSources } from "../src/provenance/types.js";

function bundle(sessionId = "session-1", turn = 1): QaTurnSources {
  return {
    version: 1,
    sessionId,
    turn,
    complete: true,
    sources: [
      {
        id: "web:https://example.com/guide",
        kind: "web",
        title: "Guide",
        uri: "https://example.com/guide",
        locations: [],
        evidence: "fetched",
        origins: [{ sessionId, turn, role: "parent" }],
        score: 100,
      },
    ],
  };
}

function emptyBundle(sessionId = "session-1", turn = 1): QaTurnSources {
  return { version: 1, sessionId, turn, complete: true, sources: [] };
}

/** A store rooted in a fresh temp directory, with explicit retention. */
function rig(retention: Partial<QaProvenanceRetention> = {}): {
  dir: string;
  legacy: string;
  store: FileQaProvenanceSnapshotStore;
} {
  const root = mkdtempSync(path.join(tmpdir(), "qa-sources-"));
  const dir = path.join(root, "qa-sources");
  return {
    dir,
    legacy: `${dir}.json`,
    store: new FileQaProvenanceSnapshotStore(dir, () => ({
      ...DEFAULT_QA_PROVENANCE_RETENTION,
      ...retention,
    })),
  };
}

function shardDir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** The shard a chat is stored under: the store's own naming rule, mirrored. */
function shardName(sessionId: string): string {
  return `${createHash("sha256").update(sessionId).digest("hex").slice(0, 16)}.json`;
}

function shardPath(dir: string, sessionId: string): string {
  return path.join(dir, shardName(sessionId));
}

describe("FileQaProvenanceSnapshotStore", () => {
  it("persists snapshots for a fresh store instance", () => {
    const { dir, store } = rig();
    store.put(bundle());

    expect(store.list("session-1")).toEqual([bundle()]);
    const [name] = shardDir(dir);
    expect(name).toBeDefined();
    expect(readFileSync(path.join(dir, name as string), "utf8")).toContain(
      '"version": 1',
    );
  });

  it("keeps one chat's rewrite out of another chat's shard", () => {
    const { dir, store } = rig();
    store.put(bundle("session-a", 1));
    const [first] = shardDir(dir);
    const before = readFileSync(path.join(dir, first as string), "utf8");

    for (let turn = 1; turn <= 20; turn += 1)
      store.put(bundle("session-b", turn));

    // Two shards, and the untouched one is byte-identical: the cost of a turn
    // no longer depends on what other chats accumulated.
    expect(shardDir(dir)).toHaveLength(2);
    expect(readFileSync(path.join(dir, first as string), "utf8")).toBe(before);
    expect(store.list("session-a")).toEqual([bundle("session-a", 1)]);
  });

  it("records an empty completed turn as a turn number, not a frame", () => {
    const { dir, store } = rig();
    store.put(emptyBundle("session-1", 7));

    expect(store.list("session-1")).toEqual([emptyBundle("session-1", 7)]);
    const [name] = shardDir(dir);
    const raw = readFileSync(path.join(dir, name as string), "utf8");
    expect(raw).toContain('"emptyTurns"');
    expect(raw).not.toContain('"sources": []');
  });

  it("never collapses an incomplete collection", () => {
    const { store } = rig();
    const incomplete: QaTurnSources = {
      ...emptyBundle("session-1", 3),
      complete: false,
    };
    store.put(incomplete);

    expect(store.list("session-1")).toEqual([incomplete]);
  });

  it("replaces a turn it already holds instead of duplicating it", () => {
    const { store } = rig();
    store.put(emptyBundle("session-1", 4));
    store.put(bundle("session-1", 4));

    expect(store.list("session-1")).toEqual([bundle("session-1", 4)]);
  });

  it("bounds a chat to the configured number of newest turns", () => {
    const { store } = rig({ maxTurnsPerSession: 5 });
    for (let turn = 1; turn <= 12; turn += 1) {
      store.put(
        turn % 2 === 0
          ? bundle("session-1", turn)
          : emptyBundle("session-1", turn),
      );
    }

    expect(store.list("session-1").map((entry) => entry.turn)).toEqual([
      8, 9, 10, 11, 12,
    ]);
  });

  it("keeps every turn when the bound is zero", () => {
    const { store } = rig({ maxTurnsPerSession: 0 });
    for (let turn = 1; turn <= 30; turn += 1)
      store.put(emptyBundle("session-1", turn));

    expect(store.list("session-1")).toHaveLength(30);
  });

  it("sweeps the least recently written chats past maxSessions", () => {
    const { dir, store } = rig({ maxSessions: 2, sweepIntervalMinutes: 1_440 });
    for (const id of ["session-a", "session-b", "session-c"]) {
      store.put(bundle(id, 1));
    }
    // Oldest first: a, then b, then c.
    const ages: [string, number][] = [
      ["session-a", 3],
      ["session-b", 2],
      ["session-c", 1],
    ];
    for (const [id, days] of ages) {
      const when = new Date(Date.now() - days * 86_400_000);
      utimesSync(shardPath(dir, id), when, when);
    }

    const result = store.sweep();

    expect(result.droppedByCount).toBe(1);
    expect(shardDir(dir)).toEqual(
      [shardName("session-b"), shardName("session-c")].sort(),
    );
    expect(store.list("session-a")).toEqual([]);
  });

  it("drops a chat that has not been written for maxAgeDays", () => {
    const { dir, store } = rig({ maxAgeDays: 7 });
    store.put(bundle("session-old", 1));
    store.put(bundle("session-fresh", 1));
    const when = new Date(Date.now() - 30 * 86_400_000);
    utimesSync(shardPath(dir, "session-old"), when, when);

    const result = store.sweep();

    expect(result.droppedByAge).toBe(1);
    expect(shardDir(dir)).toEqual([shardName("session-fresh")]);
    expect(store.list("session-old")).toEqual([]);
    expect(store.list("session-fresh")).toEqual([bundle("session-fresh", 1)]);
  });

  it("splits the pre-sharding monolith once and renames it away", () => {
    const { dir, legacy, store } = rig();
    writeFileSync(
      legacy,
      `${JSON.stringify({
        version: 1,
        sessions: {
          "session-a": {
            "1": bundle("session-a", 1),
            "2": emptyBundle("session-a", 2),
          },
          "session-b": { "1": bundle("session-b", 1) },
        },
      })}\n`,
      "utf8",
    );

    expect(store.list("session-a")).toEqual([
      bundle("session-a", 1),
      emptyBundle("session-a", 2),
    ]);
    expect(store.list("session-b")).toEqual([bundle("session-b", 1)]);
    // The monolith is retired, not deleted.
    expect(
      readdirSync(path.dirname(legacy)).some((name) =>
        name.includes(".migrated-"),
      ),
    ).toBe(true);
    expect(() => readFileSync(legacy, "utf8")).toThrow();

    // A second reader sees the shards, not a second migration.
    const reopened = new FileQaProvenanceSnapshotStore(dir);
    expect(reopened.list("session-a")).toHaveLength(2);
  });

  it("refuses to overwrite an unrecognized provenance file", () => {
    const { legacy, store } = rig();
    const invalid = '{"version":2,"sessions":{}}\n';
    writeFileSync(legacy, invalid, "utf8");

    expect(() => store.put(bundle())).toThrow(/refusing to overwrite/u);
    expect(readFileSync(legacy, "utf8")).toBe(invalid);
  });

  it("refuses to overwrite a shard it cannot recognize", () => {
    const { dir, store } = rig();
    store.put(bundle("session-1", 1));
    const [name] = shardDir(dir);
    const file = path.join(dir, name as string);
    writeFileSync(file, '{"version":9}\n', "utf8");

    expect(() => store.list("session-1")).toThrow(/refusing to overwrite/u);
    expect(() => store.put(bundle("session-1", 2))).toThrow(
      /refusing to overwrite/u,
    );
    expect(readFileSync(file, "utf8")).toBe('{"version":9}\n');
  });

  it("rejects a shard whose session does not match its name", () => {
    const { dir, store } = rig();
    store.put(bundle("session-1", 1));
    const [name] = shardDir(dir);
    const file = path.join(dir, name as string);
    const shard = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    writeFileSync(
      file,
      `${JSON.stringify({ ...shard, sessionId: "session-2" })}\n`,
      "utf8",
    );

    expect(() => store.list("session-1")).toThrow(/another chat/u);
  });
});
