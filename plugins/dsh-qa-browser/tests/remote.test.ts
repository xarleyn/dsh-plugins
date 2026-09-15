import { describe, expect, it } from "vitest";

import qaBrowserRemote from "../src/remote.js";

describe("QA Browser Remote contribution", () => {
  it("publishes strict authenticated panel descriptors", () => {
    expect(qaBrowserRemote.package).toBe("dsh-qa-browser");
    expect(qaBrowserRemote.descriptors.map((item) => item.method)).toEqual([
      "panelState",
      "panelFrame",
      "panelTakeControl",
      "panelControlHeartbeat",
      "panelReleaseControl",
      "panelSelectTab",
      "panelNavigate",
      "panelPointer",
      "panelKey",
      "panelText",
      "panelScroll",
    ]);
    for (const descriptor of qaBrowserRemote.descriptors) {
      expect(descriptor.namespace).toBe("qaBrowser");
      expect(descriptor.parameters.every((item) => item.codec.mode === "strict")).toBe(true);
      expect(descriptor.result.mode).toBe("strict");
    }
  });

  it("rejects oversized frame results at the transport boundary", () => {
    const frame = qaBrowserRemote.descriptors.find(
      (item) => item.method === "panelFrame",
    );
    const codec = frame?.result;
    if (codec?.mode !== "strict") throw new Error("panelFrame must be strict");
    expect(() =>
      codec.schema.parse({
        tabId: "tab_test",
        revision: 1,
        url: "https://example.test",
        title: "Example",
        mediaType: "image/png",
        bytes: 5 * 1024 * 1024 + 1,
        data: "AA==",
      }),
    ).toThrow();
  });
});
