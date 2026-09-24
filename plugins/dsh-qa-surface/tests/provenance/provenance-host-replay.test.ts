import { describe, expect, it } from "vitest";
import { QaProvenanceHost } from "../../src/provenance/host-store.js";
import { MemoryQaProvenanceSnapshotStore } from "../../src/provenance/snapshot-store.js";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  event,
  fakeSession,
  harness,
  readEvents,
} from "../provenance-host.helpers.js";

describe("Host provenance lifecycle", () => {
  it("replays a previously materialized qa/sources snapshot", () => {
    const bundle = {
      version: 1 as const,
      sessionId: "root",
      turn: 1,
      complete: true,
      sources: [
        {
          id: "web:https://example.com/guide",
          kind: "web" as const,
          title: "Guide",
          uri: "https://example.com/guide",
          locations: [],
          evidence: "fetched" as const,
          origins: [
            {
              sessionId: "root",
              turn: 1,
              role: "parent" as const,
            },
          ],
          score: 100,
        },
      ],
    };
    const root = fakeSession("root", [event("qa/sources", bundle, 0)]);
    const world = harness([root.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    expect(host.bundles("root")).toEqual([bundle]);
    host.dispose();
  });

  it("replays durable tool metadata without appending custom session events", () => {
    const root = fakeSession("root", readEvents("D:/repo/docs/guide.md"));
    const world = harness([root.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    expect(host.bundles("root")).toMatchObject([
      {
        sessionId: "root",
        turn: 1,
        sources: [
          {
            id: "file:docs/guide.md",
            locations: [{ path: "docs/guide.md", lineStart: 7, lineEnd: 7 }],
          },
        ],
      },
    ]);

    world.emit("agent/turn-stopping", {
      agent: { id: "root", session: root.session },
      turn: 1,
    });
    expect(root.appended).toEqual([]);
    host.dispose();
  });

  it("restores plugin-owned source snapshots after a Host restart", () => {
    const store = new MemoryQaProvenanceSnapshotStore();
    const firstSession = fakeSession(
      "root",
      readEvents("D:/repo/docs/guide.md"),
    );
    const firstWorld = harness([firstSession.session]);
    const firstHost = new QaProvenanceHost(
      firstWorld.ctx,
      () => resolveConfig(),
      store,
    );

    firstWorld.emit("agent/turn-stopping", {
      agent: { id: "root", session: firstSession.session },
      turn: 1,
    });
    expect(firstSession.appended).toEqual([]);
    firstHost.dispose();

    const restoredSession = fakeSession("root", []);
    const restoredWorld = harness([restoredSession.session]);
    const restoredHost = new QaProvenanceHost(
      restoredWorld.ctx,
      () => resolveConfig(),
      store,
    );
    expect(restoredHost.bundles("root")).toMatchObject([
      {
        sessionId: "root",
        turn: 1,
        sources: [{ id: "file:docs/guide.md" }],
      },
    ]);
    expect(restoredSession.appended).toEqual([]);
    restoredHost.dispose();
  });

  it("keeps the durable snapshots of a disposed session", () => {
    const store = new MemoryQaProvenanceSnapshotStore();
    const session = fakeSession("root", readEvents("D:/repo/docs/guide.md"));
    const world = harness([session.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig(), store);

    world.emit("agent/turn-stopping", {
      agent: { id: "root", session: session.session },
      turn: 1,
    });
    expect(store.list("root")).toHaveLength(1);
    // Disposal only forgets the in-memory records: `session/disposed` also
    // fires for runtime teardown of a chat that still exists, and the
    // durable copy is what restores its sources after a Host restart.
    world.forgetSession("root");
    expect(store.list("root")).toHaveLength(1);
    const restoredHost = new QaProvenanceHost(
      harness([]).ctx,
      () => resolveConfig(),
      store,
    );
    expect(restoredHost.bundles("root")).toMatchObject([
      {
        sessionId: "root",
        turn: 1,
        sources: [{ id: "file:docs/guide.md" }],
      },
    ]);
    restoredHost.dispose();
    host.dispose();
  });
});
