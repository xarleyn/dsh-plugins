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
      "panelNewTab",
      "panelCloseTab",
      "panelHistory",
      "panelViewport",
    ]);
    for (const descriptor of qaBrowserRemote.descriptors) {
      expect(descriptor.namespace).toBe("qaBrowser");
      expect(
        descriptor.parameters.every((item) => item.codec.mode === "strict"),
      ).toBe(true);
      expect(descriptor.result.mode).toBe("strict");
    }
  });

  it("requires the chrome's own fields on a panel tab", () => {
    const state = qaBrowserRemote.descriptors.find(
      (item) => item.method === "panelState",
    )?.result;
    if (state?.mode !== "strict") throw new Error("panelState must be strict");
    const tab = {
      id: "tab_test",
      url: "https://example.test",
      title: "Example",
      status: "ready",
      revision: 1,
      viewport: { width: 1_280, height: 720, deviceScaleFactor: 1 },
      history: { back: 1, forward: 0 },
    };
    const state$ = {
      session: null,
      tabs: [tab],
      humanControlEnabled: true,
      humanControlLeaseSeconds: 30,
      autoRevealOnAgentActivity: true,
      focusOnAutoReveal: false,
      coordinateInputEnabled: true,
    };
    expect(() => state.schema.parse(state$)).not.toThrow();
    // The chrome draws its arrows from this depth, so a tab without it must
    // never reach the browser.
    const { id, url, title, status, revision, viewport } = tab;
    expect(() =>
      state.schema.parse({
        ...state$,
        tabs: [{ id, url, title, status, revision, viewport }],
      }),
    ).toThrow();
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
