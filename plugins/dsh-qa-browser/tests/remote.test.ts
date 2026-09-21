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
      policyRefusals: [],
    };
    const state$ = {
      session: null,
      tabs: [tab],
      policyRefusals: [],
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
    // So must a tab whose refusals are missing: the strip marks the tabs the
    // policy refused something for, and an absent list is not "nothing was
    // refused", it is a tab the panel cannot decide about.
    expect(() =>
      state.schema.parse({
        ...state$,
        tabs: [{ ...tab, policyRefusals: undefined }],
      }),
    ).toThrow();
  });

  it("carries each refusal by code, kind, host, message and count", () => {
    const state = qaBrowserRemote.descriptors.find(
      (item) => item.method === "panelState",
    )?.result;
    if (state?.mode !== "strict") throw new Error("panelState must be strict");
    const refusal = {
      code: "BROWSER_HOST_BLOCKED",
      kind: "resource",
      host: "intranet.example.corp",
      message: "Private-network destinations are blocked by Browser policy.",
      count: 2,
    };
    const state$ = {
      session: null,
      tabs: [],
      policyRefusals: [refusal],
      humanControlEnabled: true,
      humanControlLeaseSeconds: 30,
      autoRevealOnAgentActivity: true,
      focusOnAutoReveal: false,
      coordinateInputEnabled: true,
    };
    expect(() => state.schema.parse(state$)).not.toThrow();
    // The same entries travel with a tab, which is how the banner explains the
    // page in front of the operator rather than the whole session.
    expect(() =>
      state.schema.parse({
        ...state$,
        session: {
          sessionId: "session_test",
          status: "ready",
          selectedTabId: "tab_test",
          tabIds: ["tab_test"],
          control: { owner: "agent", leaseExpiresAt: null },
          profileName: null,
          createdAt: 1,
          lastActivityAt: 2,
        },
        tabs: [
          {
            id: "tab_test",
            url: "https://example.test",
            title: "Example",
            status: "ready",
            revision: 1,
            viewport: { width: 1_280, height: 720, deviceScaleFactor: 1 },
            history: { back: 1, forward: 0 },
            policyRefusals: [refusal],
          },
        ],
      }),
    ).not.toThrow();
    // The taxonomy is one list: a code the error type does not name cannot
    // travel to the panel, and neither can a refusal without the host to fix,
    // a kind the panel cannot word, or a count that says nothing happened.
    for (const broken of [
      { ...refusal, code: "BROWSER_INVENTED" },
      { ...refusal, kind: "subrequest" },
      { ...refusal, count: 0 },
      { code: refusal.code, kind: refusal.kind, message: refusal.message },
    ]) {
      expect(() =>
        state.schema.parse({ ...state$, policyRefusals: [broken] }),
      ).toThrow();
    }
    // The wire keeps its own bound on the list, whatever a Host sends.
    expect(() =>
      state.schema.parse({
        ...state$,
        policyRefusals: Array.from({ length: 17 }, () => refusal),
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
