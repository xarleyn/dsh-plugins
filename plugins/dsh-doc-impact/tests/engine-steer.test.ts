import { describe, expect, it } from "vitest";

import { AUTH_RULE, engineWith, workspace } from "./engine.helpers.js";

describe("doc impact engine", () => {
  it("steers for a pending impact and stops after explicit resolution", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);

    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");

    const first = await engine.evaluateStop("a1", "/virtual", 1);
    expect(first.steer).toContain("Documentation impact check");
    expect(first.steer).toContain("doc_impact_resolve");
    expect(first.pending).toHaveLength(1);

    // Strict mode keeps reminding while unresolved.
    const second = await engine.evaluateStop("a1", "/virtual", 1);
    expect(second.steer).toBeDefined();

    const outcome = await engine.resolve("a1", "/virtual", 1, {
      ruleId: "auth",
      status: "reviewed-current",
    });
    expect(outcome.resolved).toBe(1);
    expect(outcome.remaining).toHaveLength(0);

    const third = await engine.evaluateStop("a1", "/virtual", 1);
    expect(third.steer).toBeUndefined();
  });

  it("auto-resolves when the impacted target changes (SPEC §31)", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);
    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");

    const first = await engine.evaluateStop("a1", "/virtual", 1);
    expect(first.steer).toBeDefined();

    // The agent updates the documentation in the steered step.
    state.set("docs/authentication.md", "d2");
    const second = await engine.evaluateStop("a1", "/virtual", 1);
    expect(second.steer).toBeUndefined();
    expect(second.pending).toHaveLength(0);
  });

  it("treats code+docs changed together as already satisfied (SPEC §88)", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);
    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");
    state.set("docs/authentication.md", "d2");
    const decision = await engine.evaluateStop("a1", "/virtual", 1);
    expect(decision.steer).toBeUndefined();
    expect(decision.pending).toHaveLength(0);
  });

  it("reminds only once per fingerprint in remind mode", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const ws = workspace([
      {
        id: "auth-remind",
        code: ["src/auth/**"],
        docs: ["docs/authentication.md"],
        direction: "code-to-docs",
        mode: "remind",
      },
    ]);
    const engine = engineWith(ws, state);
    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");

    const first = await engine.evaluateStop("a1", "/virtual", 1);
    expect(first.steer).toBeDefined();
    const second = await engine.evaluateStop("a1", "/virtual", 1);
    expect(second.steer).toBeUndefined();
    expect(second.pending).toHaveLength(1);
  });

  it("stops steering after maxReminderRounds (fail-open, SPEC §34)", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const ws = workspace(AUTH_RULE, {
      safety: { maxReminderRounds: 2, onLimit: "allow" },
    });
    const engine = engineWith(ws, state);
    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");

    expect(
      (await engine.evaluateStop("a1", "/virtual", 1)).steer,
    ).toBeDefined();
    expect(
      (await engine.evaluateStop("a1", "/virtual", 1)).steer,
    ).toBeDefined();
    expect(
      (await engine.evaluateStop("a1", "/virtual", 1)).steer,
    ).toBeUndefined();
  });
});
