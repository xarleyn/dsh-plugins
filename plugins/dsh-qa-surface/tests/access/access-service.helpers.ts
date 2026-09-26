import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { SkillSummary } from "@deepseek-ai/dsh-skill";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { QaAccounts } from "../../src/accounts/store.js";
import { QaAccessService } from "../../src/access/service.js";
import type { QaPresetScopeLease } from "../../src/access/capability-catalog.js";
import { QaRoleRepository } from "../../src/access/role-repository.js";
import type { QaSessionLogReader } from "../../src/admin/session-log.js";
import {
  QA_USER_SKILLS_PROVIDER,
  QA_USER_SKILLS_SOURCE,
} from "../../src/personal-skills/provider.js";
import { resolveConfig } from "../../src/resolve-config.js";
function harness(
  options: {
    /** Live session headers, for the registry half of the lineage answer. */
    readonly live?: ReadonlyMap<
      string,
      { readonly createdAt?: number; readonly parentSession?: string }
    >;
    /** Durable listing, for the sweep half. */
    readonly sessionLog?: QaSessionLogReader;
    /** Retention knobs, so a sweep test need not wait out the grace period. */
    readonly retention?: {
      readonly ownershipGraceHours?: number;
      readonly sweepIntervalMinutes?: number;
    };
    /** Collects the ids the ownership sweep reclaimed. */
    readonly onVanishedSessions?: (sessionIds: readonly string[]) => void;
    /** The standing scope lease of the QA preset, faked by the harness. */
    readonly presetScope?: () => Promise<QaPresetScopeLease | undefined>;
  } = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), "qa-access-"));
  const accounts = new QaAccounts(path.join(root, "accounts.json"), {
    sessionTtlDays: 30,
    allowRegistration: true,
  });
  const admin = accounts.register("admin@example.com", "password-1");
  const user = accounts.register("user@example.com", "password-1");
  const tools = new Set(["read", "search", "analytics", "git", "skill"]);
  const skills = new Map<string, SkillSummary>([
    [
      "company",
      {
        name: "company",
        description: "Company basics",
        invocation: { modelInvocable: true, userInvocable: true },
        source: "runtime",
        provider: "test",
      },
    ],
    [
      "data-analysis",
      {
        name: "data-analysis",
        description: "Analyze data",
        invocation: { modelInvocable: true, userInvocable: true },
        source: "runtime",
        provider: "test",
      },
    ],
  ]);
  const ctx = {
    tools: {
      schemas: (scope?: unknown) => [
        ...[...tools].map((name) => ({
          name,
          description: name,
          parameters: {},
        })),
        // A tool the preset mounts lives in the preset's scope only.
        ...(scope === undefined
          ? []
          : [{ name: "preset_tool", description: "preset", parameters: {} }]),
      ],
    },
    get: (name: string) =>
      name === "skills"
        ? {
            snapshot: async (options?: { readonly scope?: unknown }) => ({
              skills: [
                ...skills.values(),
                // Likewise a skill the kit's catalog contributes.
                ...(options?.scope === undefined
                  ? []
                  : [
                      {
                        name: "preset-search",
                        description: "Preset skill",
                        invocation: {
                          modelInvocable: true,
                          userInvocable: true,
                        },
                        source: "custom",
                        provider: "filesystem",
                      },
                    ]),
              ],
              complete: true,
            }),
          }
        : undefined,
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    ...(options.live === undefined
      ? {}
      : {
          sessions: {
            get: (id: string) => {
              const header = options.live?.get(String(id));
              return header === undefined ? undefined : { header };
            },
            list: () => [],
          },
        }),
  } as unknown as Context;
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    close() {},
  } as unknown as PluginLogger;
  const service = new QaAccessService(ctx, {
    accounts: () => accounts,
    config: () =>
      resolveConfig({
        lockdown: { toolPolicy: { allow: ["read"] } },
        ...(options.retention === undefined
          ? {}
          : { accounts: { retention: options.retention } }),
      }),
    logger,
    repository: new QaRoleRepository(path.join(root, "roles.json")),
    ...(options.presetScope === undefined
      ? {}
      : { presetScope: options.presetScope }),
    ...(options.sessionLog === undefined
      ? {}
      : { sessionLog: options.sessionLog }),
    ...(options.onVanishedSessions === undefined
      ? {}
      : { onVanishedSessions: options.onVanishedSessions }),
  });
  return { service, accounts, admin, user, tools, skills };
}

/**
 * Add one skill the account owns to the registry the harness serves, exactly as
 * the personal-skills provider publishes it: its own skills root, invocable by
 * the person and not offered to the model.
 */
function personal(skills: Map<string, SkillSummary>, name: string): void {
  skills.set(name, {
    name,
    description: `Personal ${name}`,
    invocation: { modelInvocable: false, userInvocable: true },
    source: QA_USER_SKILLS_SOURCE,
    provider: QA_USER_SKILLS_PROVIDER,
  });
}

function fakeAgent(): Agent {
  return {
    session: { header: {}, id: "session" },
  } as unknown as Agent;
}

/** A complete durable listing over fixed headers; `list` drives both sweeps. */
function reader(
  headers: readonly {
    readonly id: string;
    readonly createdAt: number;
    readonly parentSessionId?: string;
  }[],
): QaSessionLogReader {
  return {
    live: () => false,
    snapshot: () => undefined,
    list: async () => ({ headers, complete: true }),
    read: async () => ({ ok: false as const, reason: "storage-unavailable" }),
  };
}

export { fakeAgent, harness, personal, reader };
