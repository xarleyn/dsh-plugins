import { describe, expect, it } from "vitest";
import draftSessionsRemote from "../src/remote.js";

describe("draftSessions Remote contribution", () => {
  it("publishes strict descriptors for the complete v1 storage surface", () => {
    expect(draftSessionsRemote.package).toBe("dsh-draft-sessions");
    expect(draftSessionsRemote.descriptors.map((item) => item.method)).toEqual([
      "list",
      "create",
      "update",
      "delete",
      "rebind",
    ]);
    for (const descriptor of draftSessionsRemote.descriptors) {
      expect(descriptor.namespace).toBe("draftSessions");
      expect(descriptor.parameters[0]?.codec.mode).toBe("strict");
      expect(descriptor.result.mode).toBe("strict");
    }
  });

  it("rejects unknown request fields at the client boundary", () => {
    const create = draftSessionsRemote.descriptors.find(
      (item) => item.method === "create",
    );
    const codec = create?.parameters[0]?.codec;
    expect(codec?.mode).toBe("strict");
    if (codec?.mode !== "strict")
      throw new Error("create request codec is not strict");
    expect(() =>
      codec.schema.parse({ workspaceId: "w", unexpected: true }),
    ).toThrow();
  });
});
