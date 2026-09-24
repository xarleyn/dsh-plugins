import { describe, expect, it } from "vitest";
import { QaProvenanceHost } from "../../src/provenance/host-store.js";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  event,
  fakeSession,
  harness,
  readEvents,
} from "../provenance-host.helpers.js";

describe("Host provenance lifecycle", () => {
  it("serves materialized turns from the durable snapshot after the collector is dropped", () => {
    const root = fakeSession("root", readEvents("D:/repo/docs/guide.md"));
    const world = harness([root.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    world.emit("agent/turn-stopping", {
      agent: { id: "root", session: root.session },
      turn: 1,
    });
    // Materialize retires the in-memory collector; the plugin-owned snapshot
    // must keep answering bundles().
    expect(host.bundles("root")).toMatchObject([
      {
        sessionId: "root",
        turn: 1,
        sources: [
          { id: "file:docs/guide.md", locations: [{ path: "docs/guide.md" }] },
        ],
      },
    ]);
    host.dispose();
  });

  it("forgets a disposed session's in-memory provenance records", () => {
    const root = fakeSession("root", readEvents("D:/repo/docs/guide.md"));
    const world = harness([root.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    expect(host.bundles("root")).toHaveLength(1);
    expect(host.sourceAllowed("root", "docs/guide.md")).toBe(true);
    world.forgetSession("root");
    expect(host.bundles("root")).toEqual([]);
    expect(host.sourceAllowed("root", "docs/guide.md")).toBe(false);
    host.dispose();
  });

  it("forgets a subagent lineage when its session is disposed before end", () => {
    const root = fakeSession("root", [event("turn/start", { turn: 1 }, 0)]);
    const child = fakeSession("child", [], "root");
    const world = harness([root.session, child.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    world.emit("subagent/start", {
      runId: "run-1",
      provider: "local",
      id: "child",
      local: true,
    });
    world.forgetSession("child");
    world.emit("subagent/end", {
      runId: "run-1",
      provider: "local",
      id: "child",
      local: true,
    });
    // The end event finds no lineage, so nothing is inherited or marked.
    expect(host.bundles("root")).toEqual([]);
    host.dispose();
  });
});
