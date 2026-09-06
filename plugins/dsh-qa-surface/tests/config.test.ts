import { describe, expect, it } from "vitest";
import {
  DEFAULT_QA_SURFACE_CONFIG,
  normalizeRoutePath,
  resolveConfig,
} from "../src/resolve-config.js";

describe("qa surface config", () => {
  it("materializes safe defaults", () => {
    expect(resolveConfig()).toEqual(DEFAULT_QA_SURFACE_CONFIG);
    expect(resolveConfig().ui.showReasoning).toBe(false);
  });

  it("normalizes trailing route slashes", () => {
    expect(normalizeRoutePath(" /support/// ")).toBe("/support");
  });

  it.each(["", "qa", "/", "/api", "/api/private", "/plugins/client.js"])(
    "rejects reserved or malformed route %j",
    (path) => expect(() => resolveConfig({ route: { path } })).toThrow(),
  );

  it("requires an id for fixed sessions", () => {
    expect(() => resolveConfig({ session: { policy: "fixed" } })).toThrow(
      /fixedSessionId/u,
    );
  });

  it("requires provider and model together", () => {
    expect(() => resolveConfig({ session: { provider: "openai" } })).toThrow(
      /set together/u,
    );
  });

  it("rejects reasoning exposure in the safe MVP", () => {
    expect(() => resolveConfig({ ui: { showReasoning: true } })).toThrow(
      /not supported/u,
    );
  });

  it("normalizes optional strings and suggested questions", () => {
    const config = resolveConfig({
      session: { workspaceId: "  workspace-1 " },
      suggestedQuestions: [" First? ", "First?", ""],
    });
    expect(config.session.workspaceId).toBe("workspace-1");
    expect(config.suggestedQuestions).toEqual(["First?"]);
  });
});
