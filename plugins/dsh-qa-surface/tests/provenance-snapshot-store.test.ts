import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileQaProvenanceSnapshotStore } from "../src/provenance/snapshot-store.js";
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
});
