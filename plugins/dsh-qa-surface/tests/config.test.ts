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
    expect(resolveConfig()).toMatchObject({
      ui: { showReset: false },
      lockdown: {
        enabled: true,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        permissionPreset: "qa-read-only",
        allowSessionReset: false,
        toolPolicy: { mode: "allow-list", allow: [] },
      },
    });
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

  it("keeps the session list hidden by default and allows opting in", () => {
    expect(resolveConfig().ui.showSessionList).toBe(false);
    expect(
      resolveConfig({ ui: { showSessionList: true } }).ui.showSessionList,
    ).toBe(true);
  });

  it("allows operators to opt into reasoning and tool activity", () => {
    expect(
      resolveConfig({
        ui: { showReasoning: true, showToolActivity: true },
      }).ui,
    ).toMatchObject({ showReasoning: true, showToolActivity: true });
  });

  it("normalizes optional strings and suggested questions", () => {
    const config = resolveConfig({
      session: { workspaceId: "  workspace-1 " },
      suggestedQuestions: [" First? ", "First?", ""],
    });
    expect(config.session.workspaceId).toBe("workspace-1");
    expect(config.suggestedQuestions).toEqual(["First?"]);
  });

  it("requires a named permission preset while lockdown is enabled", () => {
    expect(() =>
      resolveConfig({ lockdown: { permissionPreset: "  " } }),
    ).toThrow(/permissionPreset/u);
  });

  it("requires explicit reset authorization when the reset control is shown", () => {
    expect(() => resolveConfig({ ui: { showReset: true } })).toThrow(
      /allowSessionReset/u,
    );
  });

  it.each([
    ["allowPermissionChanges", true],
    ["allowSlashCommands", true],
    ["allowSettingsMutation", true],
    ["allowSessionRename", true],
    ["allowSessionDelete", true],
    ["allowArbitrarySessionOpen", true],
  ])("rejects capability expansion through %s", (field, value) => {
    expect(() =>
      resolveConfig({
        lockdown: { [field]: value },
      } as never),
    ).toThrow(new RegExp(field, "u"));
  });
});
