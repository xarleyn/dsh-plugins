import { describe, expect, it } from "vitest";
import {
  DEFAULT_QA_SURFACE_CONFIG,
  normalizeRoutePath,
  resolveConfig,
} from "../../src/resolve-config.js";
import { DEFAULT_THINKING_PHRASES } from "../../src/thinking-phrases.js";
import { schemaParse } from "./config.helpers.js";

describe("qa surface config", () => {
  it("materializes safe defaults", () => {
    expect(resolveConfig()).toEqual(DEFAULT_QA_SURFACE_CONFIG);
    expect(resolveConfig().ui.showReasoning).toBe(false);
    expect(resolveConfig().suggestedQuestions).toEqual([
      "Что ты умеешь?",
      "С чего начать?",
      "Помоги разобраться с ошибкой",
    ]);
    expect(resolveConfig().thinkingPhrases).toEqual(DEFAULT_THINKING_PHRASES);
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
      sources: {
        enabled: true,
        collect: { parentAgent: true, subagents: true, persistTurnEvent: true },
        display: { sidebar: true, footer: true, showDiscovered: false },
        filePreview: {
          enabled: true,
          markdownRenderedByDefault: true,
          allowRawToggle: true,
          maxBytes: 2_000_000,
          maxMarkdownRenderBytes: 1_000_000,
        },
      },
    });
  });

  it("validates source display and preview limits", () => {
    expect(() =>
      resolveConfig({
        sources: {
          filePreview: { maxBytes: 2_000, maxMarkdownRenderBytes: 3_000 },
        },
      }),
    ).toThrow(/cannot exceed/u);
    expect(() =>
      resolveConfig({
        sources: { display: { maxInitiallyVisiblePerGroup: 0 } },
      }),
    ).toThrow(/maxInitiallyVisiblePerGroup/u);
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

  it("ships a default disclaimer and lets deployments hide it", () => {
    const fallback = resolveConfig().branding.disclaimer;
    expect(fallback).toContain("видны другим пользователям");
    expect(fallback).toContain("улучшения качества");
    expect(
      resolveConfig({
        branding: { disclaimer: "  Своё предупреждение.  " },
      }).branding.disclaimer,
    ).toBe("Своё предупреждение.");
    expect(
      resolveConfig({ branding: { disclaimer: null } }).branding.disclaimer,
    ).toBe("");
  });

  it("accepts an absolute cwd pin and rejects relative ones", () => {
    expect(resolveConfig({ session: { cwd: "D:/qa-docs" } }).session.cwd).toBe(
      "D:/qa-docs",
    );
    expect(
      resolveConfig({ session: { cwd: "/srv/qa-docs" } }).session.cwd,
    ).toBe("/srv/qa-docs");
    expect(() => resolveConfig({ session: { cwd: "qa-docs" } })).toThrow(
      /absolute/u,
    );
  });

  it("normalizes shared read roots and rejects relative entries", () => {
    const resolved = resolveConfig({
      lockdown: {
        sharedReadOnlyRoots: [" D:/qa/docs ", "D:/qa/code", "D:/qa/docs"],
      },
    });
    expect(resolved.lockdown.sharedReadOnlyRoots).toEqual([
      "D:/qa/docs",
      "D:/qa/code",
    ]);
    expect(() =>
      resolveConfig({ lockdown: { sharedReadOnlyRoots: ["../docs"] } }),
    ).toThrow(/absolute/u);
  });

  it("keeps workspaceId and cwd mutually exclusive", () => {
    expect(() =>
      resolveConfig({
        session: { workspaceId: "ws-1", cwd: "D:/qa-docs" },
      }),
    ).toThrow(/mutually exclusive/u);
    expect(
      resolveConfig({ session: { workspaceId: "ws-1" } }).session.cwd,
    ).toBeNull();
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

  it("signs subagent notices with codenames by default and allows opting out", () => {
    expect(resolveConfig().ui.subagentCodenames).toBe(true);
    expect(
      resolveConfig({ ui: { subagentCodenames: false } }).ui.subagentCodenames,
    ).toBe(false);
  });

  it("resolves the transcript width floor and rejects values outside it", () => {
    expect(resolveConfig().ui.minContentWidth).toBe(650);
    expect(
      resolveConfig({ ui: { minContentWidth: 1_200 } }).ui.minContentWidth,
    ).toBe(1_200);
    expect(() => resolveConfig({ ui: { minContentWidth: 100 } })).toThrow(
      /ui\.minContentWidth/u,
    );
    expect(() => resolveConfig({ ui: { minContentWidth: 1_700 } })).toThrow(
      /ui\.minContentWidth/u,
    );
  });

  // The width bound flipped from a cap to a floor; a deployment that still
  // carries the removed key keeps working on the shipped default.
  it("ignores the removed maxContentWidth key", () => {
    const config = resolveConfig(schemaParse({ ui: { maxContentWidth: 900 } }));
    expect(config.ui.minContentWidth).toBe(
      DEFAULT_QA_SURFACE_CONFIG.ui.minContentWidth,
    );
  });
});
