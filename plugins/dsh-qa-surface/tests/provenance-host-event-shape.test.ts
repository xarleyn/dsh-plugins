import { describe, expect, it } from "vitest";
import { QaProvenanceHost } from "../src/provenance/host-store.js";
import { resolveConfig } from "../src/resolve-config.js";
import { fakeSession, harness, readEvents } from "./provenance-host.helpers.js";

describe("Host provenance event shape", () => {
  it("collects a turn's sources from the tool/result the Harness writes", () => {
    const root = fakeSession("root", readEvents("D:/repo/docs/guide.md"));
    const world = harness([root.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    // The Harness pairs a result with its call by the block's `toolCallId`;
    // the shape these tests used to replay named it `callId`. Reading only the
    // latter collects nothing on a real Host, and the empty bundle is what
    // leaves the sources panel, the file preview and the chat evidence bare.
    expect(host.bundles("root")).toMatchObject([
      {
        sessionId: "root",
        turn: 1,
        sources: [
          {
            id: "file:docs/guide.md",
            locations: [{ path: "docs/guide.md", lineStart: 7, lineEnd: 7 }],
            origins: [{ toolCallId: "call-1", toolName: "read" }],
          },
        ],
      },
    ]);
    // The preview of the read file is authorized by that same collected origin.
    expect(host.sourceAllowed("root", "docs/guide.md")).toBe(true);
    host.dispose();
  });

  it("pairs a durable journal whose result block still names callId", () => {
    const root = fakeSession("root", readEvents("D:/repo/docs/guide.md", true));
    const world = harness([root.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    expect(host.sourceAllowed("root", "docs/guide.md")).toBe(true);
    host.dispose();
  });
});
