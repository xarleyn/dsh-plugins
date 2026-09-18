import { describe, expect, it } from "vitest";

import { DocImpactEngine } from "../src/engine/runtime.js";

import { AUTH_RULE, engineWith, workspace } from "./engine.helpers.js";

describe("doc impact engine", () => {
  it("rejects updated-resolution when the target did not change", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);
    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");
    await engine.evaluateStop("a1", "/virtual", 1);

    await expect(
      engine.resolve("a1", "/virtual", 1, {
        ruleId: "auth",
        status: "updated",
      }),
    ).rejects.toThrow("updated resolution requires a changed target file");
  });

  it("rejects not-applicable without a reason", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);
    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");
    await engine.evaluateStop("a1", "/virtual", 1);

    await expect(
      engine.resolve("a1", "/virtual", 1, {
        ruleId: "auth",
        status: "not-applicable",
      }),
    ).rejects.toThrow("non-empty reason");
  });

  it("fails open when the config is missing", async () => {
    const engine = new DocImpactEngine({
      configProvider: async () => undefined,
    });
    await engine.ensureBaseline("a2", "/nowhere", 1);
    const decision = await engine.evaluateStop("a2", "/nowhere", 1);
    expect(decision.steer).toBeUndefined();
    expect(decision.pending).toHaveLength(0);
  });

  it("keeps separate runtimes per turn (turn scope)", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);
    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");
    expect(
      (await engine.evaluateStop("a1", "/virtual", 1)).steer,
    ).toBeDefined();
    engine.disposeTurn("a1", 1);

    // Turn 2: fresh baseline → the (already committed) change is invisible.
    await engine.ensureBaseline("a1", "/virtual", 2);
    const next = await engine.evaluateStop("a1", "/virtual", 2);
    expect(next.steer).toBeUndefined();
    expect(next.changed).toHaveLength(0);
  });
});
