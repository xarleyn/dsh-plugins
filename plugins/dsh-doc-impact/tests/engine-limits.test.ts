import { describe, expect, it } from "vitest";

import { AUTH_RULE, engineWith, workspace } from "./engine.helpers.js";

describe("doc impact engine", () => {
  it("errors loudly once at the limit when onLimit is error", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const logged: string[] = [];
    const ws = workspace(AUTH_RULE, {
      safety: { maxReminderRounds: 1, onLimit: "error" },
    });
    const engine = engineWith(ws, state, {
      logger: {
        warn() {},
        info() {},
        error: (message) => logged.push(message),
      },
    });
    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");

    expect(
      (await engine.evaluateStop("a1", "/virtual", 1)).steer,
    ).toBeDefined();
    const limited = await engine.evaluateStop("a1", "/virtual", 1);
    expect(limited.steer).toContain("reminder limit reached");
    // The final notice fires once, not on every subsequent stop.
    const again = await engine.evaluateStop("a1", "/virtual", 1);
    expect(again.steer).toBeUndefined();
    expect(logged).toHaveLength(1);
  });

  it("still steers and logs when the attribution probe throws (regression)", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const infos: string[] = [];
    const warns: string[] = [];
    const engine = engineWith(workspace(AUTH_RULE), state, {
      concurrentAgents: () => {
        throw new Error('cannot get property "agents" without inject');
      },
      logger: {
        info: (message) => infos.push(message),
        warn: (message) => warns.push(message),
        error() {},
      },
    });
    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");

    const decision = await engine.evaluateStop("a1", "/virtual", 1);
    // A probe failure degrades the attribution; it must never drop the reminder.
    expect(decision.steer).toContain("Documentation impact check");
    expect(decision.steer).toContain("auth");
    expect(
      warns.some((message) => message.includes("attribution probe failed")),
    ).toBe(true);
    expect(
      infos.some(
        (message) =>
          message.includes("reminder sent") && message.includes("auth"),
      ),
    ).toBe(true);
  });

  it("logs the reminder limit once under onLimit allow", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const infos: string[] = [];
    const ws = workspace(AUTH_RULE, {
      safety: { maxReminderRounds: 1, onLimit: "allow" },
    });
    const engine = engineWith(ws, state, {
      logger: { info: (message) => infos.push(message), warn() {}, error() {} },
    });
    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");

    expect(
      (await engine.evaluateStop("a1", "/virtual", 1)).steer,
    ).toBeDefined();
    expect(
      (await engine.evaluateStop("a1", "/virtual", 1)).steer,
    ).toBeUndefined();
    expect(
      (await engine.evaluateStop("a1", "/virtual", 1)).steer,
    ).toBeUndefined();
    const limitLines = infos.filter((message) =>
      message.includes("reminder limit reached"),
    );
    expect(limitLines).toHaveLength(1);
    expect(limitLines[0]).toContain("onLimit: allow");
  });

  it("logs auto-resolution when the agent catches the documentation up (SPEC §31)", async () => {
    const state = new Map<string, string>([
      ["src/auth/session.ts", "v1"],
      ["docs/authentication.md", "d1"],
    ]);
    const infos: string[] = [];
    const engine = engineWith(workspace(AUTH_RULE), state, {
      logger: { info: (message) => infos.push(message), warn() {}, error() {} },
    });
    await engine.ensureBaseline("a1", "/virtual", 1);
    state.set("src/auth/session.ts", "v2");
    expect(
      (await engine.evaluateStop("a1", "/virtual", 1)).steer,
    ).toBeDefined();

    state.set("docs/authentication.md", "d2");
    expect(
      (await engine.evaluateStop("a1", "/virtual", 1)).steer,
    ).toBeUndefined();
    expect(
      infos.some((message) =>
        message.includes("auto-resolved impact for rule auth"),
      ),
    ).toBe(true);
  });
});
