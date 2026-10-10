import { describe, expect, it } from "vitest";
import { QaProvenanceHost } from "../../src/provenance/host-store.js";
import { MemoryQaProvenanceSnapshotStore } from "../../src/provenance/snapshot-store.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { fakeSession, harness, readEvents } from "./provenance-host.helpers.js";

describe("branch source snapshots", () => {
  it("keeps exact included evidence after replay and source deletion, excluding later turns", () => {
    const store = new MemoryQaProvenanceSnapshotStore();
    const source = {
      id: "web:https://example.com/guide", kind: "web" as const,
      title: "Guide", uri: "https://example.com/guide", locations: [],
      evidence: "reported" as const, origins: [{ sessionId: "parent", turn: 1, role: "parent" as const }], score: 100,
    };
    store.put({ version: 1, sessionId: "parent", turn: 1, complete: true, sources: [source] });
    store.put({ version: 1, sessionId: "parent", turn: 2, complete: true, sources: [{ ...source, id: "later" }] });
    const child = fakeSession("branch", readEvents("D:/repo/docs/guide.md"), "parent");
    Object.assign(child.session.header, { isSeeded: true, origin: undefined });
    Object.assign(child.session, { inheritedEventCount: 4 });
    const host = new QaProvenanceHost(harness([child.session]).ctx, () => resolveConfig(), store);
    host.forkSnapshots("parent", "branch", 1);
    expect(host.bundles("branch")).toEqual([{ version: 1, sessionId: "branch", turn: 1, complete: true, sources: [source] }]);
    host.dropSession("parent");
    host.dispose();
    const restored = new QaProvenanceHost(harness([child.session]).ctx, () => resolveConfig(), store);
    expect(restored.bundles("branch")).toEqual([{ version: 1, sessionId: "branch", turn: 1, complete: true, sources: [source] }]);
    expect(restored.bundles("branch").flatMap((bundle) => bundle.sources).some((entry) => entry.id === "later")).toBe(false);
    restored.dispose();
  });
});
