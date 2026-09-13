import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { DEFAULT_QA_TEXT_EXTENSIONS } from "../src/attachment-rules.js";
import {
  DEFAULT_QA_SURFACE_CONFIG,
  normalizeRoutePath,
  resolveConfig,
} from "../src/resolve-config.js";
import { DEFAULT_THINKING_PHRASES } from "../src/thinking-phrases.js";
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

  it("carries operator phrases through the schema into the resolved config", () => {
    expect(
      resolveConfig(schemaParse({ thinkingPhrases: [" Точу ", "Точу"] }))
        .thinkingPhrases,
    ).toEqual(["Точу"]);
  });

  it("keeps reported-source validation on until the deployment turns it off", () => {
    expect(resolveConfig().sources.subagents.validateReportedSources).toBe(
      true,
    );
    expect(
      resolveConfig(
        schemaParse({
          sources: { subagents: { validateReportedSources: false } },
        }),
      ).sources.subagents.validateReportedSources,
    ).toBe(false);
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

  it("normalizes the running phrases", () => {
    const config = resolveConfig({
      thinkingPhrases: [" Точу ", "Точу", "", "  "],
    });
    expect(config.thinkingPhrases).toEqual(["Точу"]);
  });

  it("defaults attachment intake to text files with a 200-line paste rule", () => {
    expect(resolveConfig().attachments).toEqual({
      textFiles: true,
      pastedTextLines: 200,
      maxFileBytes: 10_485_760,
      maxPending: 8,
      extensions: DEFAULT_QA_TEXT_EXTENSIONS,
    });
  });

  it("normalizes the configured extension list", () => {
    const config = resolveConfig({
      attachments: { extensions: [".MD", "TXT", "md", "a b", ""] },
    });
    expect(config.attachments.extensions).toEqual(["md", "txt"]);
  });

  it("bounds the attachment numbers and pins the paste rule to integers", () => {
    expect(() =>
      resolveConfig({ attachments: { pastedTextLines: -1 } }),
    ).toThrow(/attachments\.pastedTextLines/u);
    expect(() =>
      resolveConfig({ attachments: { pastedTextLines: 1.5 } }),
    ).toThrow(/attachments\.pastedTextLines/u);
    expect(() => resolveConfig({ attachments: { maxFileBytes: 512 } })).toThrow(
      /attachments\.maxFileBytes/u,
    );
    expect(() => resolveConfig({ attachments: { maxPending: 0 } })).toThrow(
      /attachments\.maxPending/u,
    );
    // Zero is meaningful: it turns the paste conversion off without
    // disabling text files.
    expect(
      resolveConfig({ attachments: { pastedTextLines: 0 } }).attachments
        .pastedTextLines,
    ).toBe(0);
  });

  it("restores the built-in running phrases for an empty list", () => {
    // Unlike quick questions, an empty list cannot hide the indicator, so it
    // degrades back to the shipped phrases instead of silencing the label.
    expect(resolveConfig({ thinkingPhrases: [] }).thinkingPhrases).toEqual(
      DEFAULT_THINKING_PHRASES,
    );
    expect(resolveConfig({ thinkingPhrases: ["  "] }).thinkingPhrases).toEqual(
      DEFAULT_THINKING_PHRASES,
    );
  });

  it("rejects a running phrase that cannot fit the indicator", () => {
    expect(() => resolveConfig({ thinkingPhrases: ["я".repeat(121)] })).toThrow(
      /thinking phrases/u,
    );
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
      profile: {
        enabled: true,
        inject: true,
        identities: [],
        instructionsMaxLength: 2_000,
      },
    });
    expect(resolveConfig().entry).toEqual({
      redirectNonLoopback: true,
      cookieBootstrap: true,
    });
  });

  it("validates the declared identity fields and the instruction cap", () => {
    const resolved = resolveConfig(
      schemaParse({
        accounts: {
          profile: {
            identities: [{ key: " JIRA ", label: " Jira " }],
            instructionsMaxLength: 500,
          },
        },
      }),
    );
    expect(resolved.accounts.profile).toEqual({
      enabled: true,
      inject: true,
      identities: [{ key: "jira", label: "Jira" }],
      instructionsMaxLength: 500,
    });
    // A field with no label still renders: the key is the fallback copy.
    expect(
      resolveConfig(
        schemaParse({
          accounts: { profile: { identities: [{ key: "gitlab" }] } },
        }),
      ).accounts.profile.identities,
    ).toEqual([{ key: "gitlab", label: "gitlab" }]);
    expect(() =>
      resolveConfig({
        accounts: { profile: { identities: [{ key: "bad key!" }] } },
      }),
    ).toThrow(/lowercase labels/u);
    expect(() =>
      resolveConfig({
        accounts: {
          profile: { identities: [{ key: "jira" }, { key: "JIRA" }] },
        },
      }),
    ).toThrow(/twice/u);
    expect(
      ConfigSchema["~standard"].validate({
        accounts: { profile: { identities: [{ label: "no key" }] } },
      }),
    ).toHaveProperty("issues");
    for (const instructionsMaxLength of [0, 199, 20_001]) {
      expect(() =>
        resolveConfig({ accounts: { profile: { instructionsMaxLength } } }),
      ).toThrow(/instructionsMaxLength/u);
    }
    const off = resolveConfig({
      accounts: { profile: { enabled: false, inject: false } },
    });
    expect(off.accounts.profile).toMatchObject({
      enabled: false,
      inject: false,
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
        profile: {
          enabled: true,
          inject: true,
          identities: [],
          instructionsMaxLength: 2_000,
        },
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
