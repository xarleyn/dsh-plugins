import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";
import {
  DEFAULT_QA_SURFACE_CONFIG,
  normalizeRoutePath,
  resolveConfig,
} from "../src/resolve-config.js";
import type { QaSurfaceConfig } from "../src/types.js";

/** Parse through the Host's config path: schema first, resolver second. */
function schemaParse(input: unknown): QaSurfaceConfig {
  const result = ConfigSchema["~standard"].validate(input);
  if ("issues" in result && result.issues !== undefined) {
    throw new Error(`schema rejected ${JSON.stringify(input)}`);
  }
  return (result as { value: QaSurfaceConfig }).value;
}

describe("ConfigSchema defaults", () => {
  // The host materializes schema defaults before resolveConfig sees the
  // config, so a schema-only default would reach the resolver as an explicit
  // value; these tests pin the schema against the canonical defaults.
  it("resolves schema-materialized defaults to the canonical config", () => {
    for (const input of [undefined, {}]) {
      expect(resolveConfig(schemaParse(input))).toEqual(
        DEFAULT_QA_SURFACE_CONFIG,
      );
    }
  });

  it("keeps ui.showReset off until lockdown authorizes it", () => {
    expect(resolveConfig(schemaParse(undefined)).ui.showReset).toBe(false);
    expect(() => resolveConfig({ ui: { showReset: true } })).toThrow(
      /allowSessionReset/u,
    );
    expect(
      resolveConfig(
        schemaParse({
          ui: { showReset: true },
          lockdown: { allowSessionReset: true },
        }),
      ).ui.showReset,
    ).toBe(true);
  });
});

describe("qa surface config", () => {
  it("materializes safe defaults", () => {
    expect(resolveConfig()).toEqual(DEFAULT_QA_SURFACE_CONFIG);
    expect(resolveConfig().ui.showReasoning).toBe(false);
    expect(resolveConfig().suggestedQuestions).toEqual([
      "Что ты умеешь?",
      "С чего начать?",
      "Помоги разобраться с ошибкой",
    ]);
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

  it("hides other users' chats by default and allows admins to opt in", () => {
    expect(resolveConfig().accounts.showOtherUsersChats).toBe(false);
    expect(
      resolveConfig({ accounts: { showOtherUsersChats: true } }).accounts
        .showOtherUsersChats,
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

  it("allows the default quick questions to be disabled", () => {
    expect(
      resolveConfig({ suggestedQuestions: [] }).suggestedQuestions,
    ).toEqual([]);
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

  it("keeps accounts off and registration open by default", () => {
    expect(resolveConfig().accounts).toEqual({
      enabled: false,
      allowRegistration: true,
      sessionTtlDays: 30,
      showOtherUsersChats: false,
      perUserWorkspace: false,
    });
    expect(resolveConfig().entry).toEqual({
      redirectNonLoopback: true,
      cookieBootstrap: true,
    });
  });

  it("validates the account token lifetime", () => {
    expect(() => resolveConfig({ accounts: { sessionTtlDays: 0 } })).toThrow(
      /sessionTtlDays/u,
    );
    expect(() => resolveConfig({ accounts: { sessionTtlDays: 366 } })).toThrow(
      /sessionTtlDays/u,
    );
    expect(resolveConfig({ accounts: { sessionTtlDays: 7 } }).accounts).toEqual(
      {
        enabled: false,
        allowRegistration: true,
        sessionTtlDays: 7,
        showOtherUsersChats: false,
        perUserWorkspace: false,
      },
    );
  });

  it("requires the complete per-user writable workspace boundary", () => {
    const valid = resolveConfig({
      session: { workspaceId: "workspace-1" },
      accounts: { enabled: true, perUserWorkspace: true },
      lockdown: {
        sandboxMode: "workspace-write",
        permissionPreset: "qa-workspace-write",
      },
    });
    expect(valid.accounts.perUserWorkspace).toBe(true);
    expect(valid.lockdown.sandboxMode).toBe("workspace-write");

    expect(() =>
      resolveConfig({
        accounts: { enabled: true, perUserWorkspace: true },
        lockdown: { sandboxMode: "workspace-write" },
      }),
    ).toThrow(/workspaceId/u);
    expect(() =>
      resolveConfig({ lockdown: { sandboxMode: "workspace-write" } }),
    ).toThrow(/perUserWorkspace/u);
    expect(() =>
      resolveConfig({
        session: {
          workspaceId: "workspace-1",
          policy: "fixed",
          fixedSessionId: "fixed",
        },
        accounts: { enabled: true, perUserWorkspace: true },
        lockdown: { sandboxMode: "workspace-write" },
      }),
    ).toThrow(/fixed sessions/u);
  });
});
