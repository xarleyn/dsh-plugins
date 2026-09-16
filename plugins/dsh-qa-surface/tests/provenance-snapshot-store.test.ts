import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileQaProvenanceSnapshotStore,
  MAX_QA_SOURCE_SESSIONS,
  MAX_QA_SOURCE_TURNS_PER_SESSION,
} from "../src/provenance/snapshot-store.js";
import type { QaTurnSources } from "../src/provenance/types.js";

function bundle(turn = 1): QaTurnSources {
  return {
    version: 1,
    sessionId: "session-1",
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
        origins: [{ sessionId: "session-1", turn, role: "parent" }],
        score: 100,
      },
    ],
  };
}

function bundleFor(sessionId: string, turn = 1): QaTurnSources {
  const source = bundle(turn).sources[0]!;
  return {
    version: 1,
    sessionId,
    turn,
    complete: true,
    sources: [
      {
        ...source,
        origins: [{ sessionId, turn, role: "parent" as const }],
      },
    ],
  };
}

describe("FileQaProvenanceSnapshotStore", () => {
  it("atomically persists snapshots for a fresh store instance", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-sources-"));
    const file = path.join(dir, "qa-sources.json");
    new FileQaProvenanceSnapshotStore(file).put(bundle());

    expect(new FileQaProvenanceSnapshotStore(file).list("session-1")).toEqual([
      bundle(),
    ]);
    expect(readFileSync(file, "utf8")).toContain('"version": 1');
  });

  it("refuses to overwrite an unrecognized provenance file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-sources-invalid-"));
    const file = path.join(dir, "qa-sources.json");
    const invalid = '{"version":2,"sessions":{}}\n';
    writeFileSync(file, invalid, "utf8");

    expect(() => new FileQaProvenanceSnapshotStore(file).put(bundle())).toThrow(
      /refusing to overwrite/u,
    );
    expect(readFileSync(file, "utf8")).toBe(invalid);
  });

  it("rejects snapshots stored under a mismatched turn key", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-sources-mismatch-"));
    const file = path.join(dir, "qa-sources.json");
    writeFileSync(
      file,
      `${JSON.stringify({
        version: 1,
        sessions: { "session-1": { "9": bundle(1) } },
      })}\n`,
      "utf8",
    );

    expect(() =>
      new FileQaProvenanceSnapshotStore(file).list("session-1"),
    ).toThrow(/wrong session or turn/u);
  });

  it("sees another writer's snapshots instead of clobbering them", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-sources-shared-"));
    const file = path.join(dir, "qa-sources.json");
    // Two Host-side stores on one file, as after a Host restart mid-chat: the
    // stamp cache must re-read the disk copy another process has replaced.
    const first = new FileQaProvenanceSnapshotStore(file);
    const second = new FileQaProvenanceSnapshotStore(file);
    first.put(bundle(1));
    second.put(bundle(2));
    expect(first.list("session-1").map((entry) => entry.turn)).toEqual([1, 2]);
    expect(second.list("session-1").map((entry) => entry.turn)).toEqual([1, 2]);
  });

  it("keeps only the newest turns of one session", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-sources-turns-"));
    const file = path.join(dir, "qa-sources.json");
    const store = new FileQaProvenanceSnapshotStore(file);
    for (let turn = 1; turn <= MAX_QA_SOURCE_TURNS_PER_SESSION + 2; turn += 1) {
      store.put(bundle(turn));
    }
    const turns = store.list("session-1").map((entry) => entry.turn);
    expect(turns).toHaveLength(MAX_QA_SOURCE_TURNS_PER_SESSION);
    expect(turns[0]).toBe(3);
    expect(turns.at(-1)).toBe(MAX_QA_SOURCE_TURNS_PER_SESSION + 2);
  });

  it("evicts the least recently put sessions beyond the cap", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-sources-sessions-"));
    const file = path.join(dir, "qa-sources.json");
    const store = new FileQaProvenanceSnapshotStore(file);
    for (let index = 0; index < MAX_QA_SOURCE_SESSIONS + 2; index += 1) {
      store.put(bundleFor(`session-${index}`));
    }
    // The two oldest sessions fell off; a refreshed one would have stayed.
    expect(store.list("session-0")).toEqual([]);
    expect(store.list("session-1")).toEqual([]);
    expect(store.list("session-2").map((entry) => entry.turn)).toEqual([1]);
    expect(
      store
        .list(`session-${MAX_QA_SOURCE_SESSIONS + 1}`)
        .map((entry) => entry.turn),
    ).toEqual([1]);
  });

  it("drops one session's snapshots on disposal", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-sources-drop-"));
    const file = path.join(dir, "qa-sources.json");
    const store = new FileQaProvenanceSnapshotStore(file);
    store.put(bundleFor("session-gone"));
    store.put(bundleFor("session-kept"));
    store.drop("session-gone");
    expect(store.list("session-gone")).toEqual([]);
    expect(store.list("session-kept").map((entry) => entry.turn)).toEqual([1]);
    // The drop is durable: a fresh store reads the trimmed file.
    expect(
      new FileQaProvenanceSnapshotStore(file).list("session-gone"),
    ).toEqual([]);
  });

  it("creates the provenance file readable by its owner only", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-sources-mode-"));
    const file = path.join(dir, "qa-sources.json");
    new FileQaProvenanceSnapshotStore(file).put(bundle());
    // Windows ignores the creation mode; the platform's own ACLs cover it.
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });
});
