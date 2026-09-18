import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { resolveConfig } from "../src/resolve-config.js";
import { schemaParse } from "./config.helpers.js";

describe("qa surface config", () => {
  it("keeps accounts off and registration open by default", () => {
    expect(resolveConfig().accounts).toEqual({
      enabled: false,
      allowRegistration: true,
      sessionTtlDays: 30,
      maxAuthAttemptsPerMinute: 30,
      showOtherUsersChats: false,
      perUserWorkspace: false,
      // Ownership records of chats the Harness no longer knows are reclaimed
      // hourly, and only once they are a day old.
      retention: {
        pruneVanishedSessions: true,
        ownershipGraceHours: 24,
        sweepIntervalMinutes: 60,
      },
      profile: {
        enabled: true,
        inject: true,
        identities: [],
        instructionsMaxLength: 2_000,
      },
      starters: {
        enabled: true,
      },
      // No accounts means no per-account directory to store skills in.
      skills: {
        enabled: false,
        relativeRoot: ".dsh/skills",
        watch: true,
        maxSkillBytes: 262_144,
        allowResourceEditing: false,
      },
    });
    expect(resolveConfig().entry).toEqual({
      redirectNonLoopback: true,
      cookieBootstrap: true,
    });
  });

  it("resolves the login attempt budget and the cookie bootstrap flag", () => {
    expect(resolveConfig().accounts.maxAuthAttemptsPerMinute).toBe(30);
    expect(
      resolveConfig({ accounts: { maxAuthAttemptsPerMinute: 120 } }).accounts
        .maxAuthAttemptsPerMinute,
    ).toBe(120);
    for (const maxAuthAttemptsPerMinute of [0, -5, 601, 1.5]) {
      expect(() =>
        resolveConfig({ accounts: { maxAuthAttemptsPerMinute } }),
      ).toThrow(/maxAuthAttemptsPerMinute/u);
    }
    // The schema exposes the entry keys: an operator can disable the /qa
    // cookie bootstrap without patching the plugin.
    expect(resolveConfig().entry.cookieBootstrap).toBe(true);
    expect(resolveConfig({ entry: { cookieBootstrap: false } }).entry).toEqual({
      redirectNonLoopback: true,
      cookieBootstrap: false,
    });
    expect(
      ConfigSchema["~standard"].validate({
        entry: { cookieBootstrap: "yes" },
      }),
    ).toHaveProperty("issues");
  });

  it("resolves the per-account starters flag", () => {
    expect(resolveConfig().accounts.starters).toEqual({ enabled: true });
    expect(
      resolveConfig({ accounts: { starters: { enabled: false } } }).accounts
        .starters,
    ).toEqual({ enabled: false });
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
        maxAuthAttemptsPerMinute: 30,
        showOtherUsersChats: false,
        perUserWorkspace: false,
        retention: {
          pruneVanishedSessions: true,
          ownershipGraceHours: 24,
          sweepIntervalMinutes: 60,
        },
        profile: {
          enabled: true,
          inject: true,
          identities: [],
          instructionsMaxLength: 2_000,
        },
        starters: {
          enabled: true,
        },
        skills: {
          enabled: false,
          relativeRoot: ".dsh/skills",
          watch: true,
          maxSkillBytes: 262_144,
          allowResourceEditing: false,
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

  it("resolves the QA tool delivery defaults and rejects an impossible policy", () => {
    expect(resolveConfig().tools).toEqual({
      dynamicActivation: true,
      activationSkill: "qa-surface",
      activationMode: "all",
      activationPresets: [],
    });
    expect(
      resolveConfig(
        schemaParse({
          tools: {
            dynamicActivation: false,
            activationSkill: "qa-research",
            activationPresets: ["qa-research"],
          },
        }),
      ).tools,
    ).toEqual({
      dynamicActivation: false,
      activationSkill: "qa-research",
      activationMode: "all",
      activationPresets: ["qa-research"],
    });
    // A typo in the trigger must fail the boot, not silently disable the
    // feature for the whole deployment.
    expect(() =>
      resolveConfig({ tools: { activationSkill: "QA Surface" } }),
    ).toThrow(/kebab-case/u);
    expect(() => resolveConfig({ tools: { activationPresets: [""] } })).toThrow(
      /empty names/u,
    );
  });
});
