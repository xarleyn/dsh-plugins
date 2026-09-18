import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { QaAccounts, QaAccountsError } from "../src/accounts/store.js";
import { QaAccessService } from "../src/access/service.js";
import { QaRoleRepository } from "../src/access/role-repository.js";
import { QaAdminService } from "../src/admin/service.js";
import { QaQualityStore } from "../src/admin/quality-store.js";
import {
  staticSessionLogReader,
  type QaStoredSessionEraser,
  type QaStoredSessionHeader,
} from "../src/admin/session-log.js";
import type { StoredSessionEvent } from "../src/admin/conversation-log.js";
import { resolveConfig } from "../src/resolve-config.js";

/**
 * One conversation log per fixture chat: a human prompt, an answer carrying a
 * skill load and a failed tool call, and — for the second chat — a second turn.
 */
export function logFor(
  title: string,
  prompt: string,
  answer: string,
): StoredSessionEvent[] {
  return [
    { seq: 0, type: "session/title", data: { title }, time: 1_700_000_000_000 },
    {
      seq: 1,
      type: "user/message",
      data: {
        content: [{ type: "text", text: prompt }],
        source: { kind: "user" },
      },
      time: 1_700_000_001_000,
    },
    {
      seq: 2,
      type: "assistant/message",
      data: {
        message: {
          role: "assistant",
          content: [{ type: "text", text: answer }],
          source: { kind: "model", provider: "zai", model: "glm-4.7" },
        },
        usage: { inputTokens: 100, outputTokens: 25 },
      },
      time: 1_700_000_002_000,
    },
    {
      seq: 3,
      type: "tool/call",
      data: {
        callId: "c1",
        name: "skill",
        arguments: '{"name":"release-notes"}',
      },
      time: 1_700_000_002_100,
    },
    {
      seq: 4,
      type: "tool/result",
      data: {
        message: {
          content: [
            {
              type: "tool-result",
              toolCallId: "c1",
              content: [{ type: "text", text: "loaded" }],
            },
          ],
        },
      },
      time: 1_700_000_002_200,
    },
    {
      seq: 5,
      type: "tool/call",
      data: {
        callId: "c2",
        name: "git_readonly",
        arguments: '{"repository":"api"}',
      },
      time: 1_700_000_003_000,
    },
    {
      seq: 6,
      type: "tool/result",
      data: {
        message: {
          content: [
            {
              type: "tool-result",
              toolCallId: "c2",
              content: [{ type: "text", text: "not a repository" }],
              isError: true,
            },
          ],
        },
        error: { name: "git", code: "E1" },
      },
      time: 1_700_000_003_500,
    },
  ];
}

/**
 * One deployment's live registries. Empty by default: most admin reads answer
 * from the stores, and the effective-capability counts of a deployment with no
 * catalogue are all zero.
 */
export function harness(
  catalog: {
    readonly tools?: readonly string[];
    readonly skills?: readonly string[];
    /** Skills that declare an audience in their own SKILL.md metadata. */
    readonly declared?: readonly {
      readonly name: string;
      readonly roles: readonly string[];
    }[];
    /** The deployment's pinned tool policy, part of every profile. */
    readonly pinned?: readonly string[];
    /** Stored-session removal the deployment offers, if any. */
    readonly sessionFiles?: QaStoredSessionEraser;
    /** Collector for the sessions whose collected sources were dropped. */
    readonly droppedSources?: string[];
    /** Ids the fixture's Harness still holds open. */
    readonly held?: readonly string[];
    /** Sessions the deployment lists besides the two fixture chats. */
    readonly extraSessions?: readonly QaStoredSessionHeader[];
  } = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), "qa-admin-"));
  const accounts = new QaAccounts(path.join(root, "accounts.json"), {
    sessionTtlDays: 30,
    allowRegistration: true,
  });
  const admin = accounts.register("admin@example.com", "password-1");
  const reviewer = accounts.register("reviewer@example.com", "password-1");
  const alice = accounts.register("alice@example.com", "password-1");
  const bob = accounts.register("bob@example.com", "password-1");
  const accounts2 = accounts;
  accounts2.setUserRole("admin@example.com", "admin");
  accounts2.setUserRole("reviewer@example.com", "reviewer");

  const skillNames = [...(catalog.skills ?? [])];
  const ctx = {
    tools: {
      schemas: () => (catalog.tools ?? []).map((name) => ({ name })),
    },
    get: (service: string) => {
      const declared = catalog.declared ?? [];
      if (
        service !== "skills" ||
        (skillNames.length === 0 && declared.length === 0)
      ) {
        return undefined;
      }
      const names = [
        ...new Set([...skillNames, ...declared.map(({ name }) => name)]),
      ];
      return {
        snapshot: async () => ({
          skills: names.map((name) => ({
            name,
            description: `${name} skill`,
            provider: "plugin",
            source: "plugin",
            invocation: { modelInvocable: true, userInvocable: true },
          })),
        }),
        get: async (name: string) => {
          const entry = declared.find((candidate) => candidate.name === name);
          return entry === undefined
            ? { metadata: undefined }
            : {
                metadata: {
                  "qa-surface": {
                    version: 1,
                    audience: { type: "subroles", include: [...entry.roles] },
                  },
                },
              };
        },
      };
    },
  } as unknown as Context;
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    close() {},
  } as unknown as PluginLogger;
  const roles = new QaRoleRepository(path.join(root, "roles.json"));
  roles.create(admin.user.id, {
    id: "analyst",
    name: "Analyst",
    enabled: true,
    capabilities: {
      tools: { always: ["read"], skillGrantable: [] },
      skills: ["release-notes"],
    },
  });
  roles.create(admin.user.id, {
    id: "developer",
    name: "Developer",
    enabled: true,
    capabilities: {
      tools: { always: ["git"], skillGrantable: [] },
      skills: [],
    },
  });
  accounts.setAccess(alice.user.id, {
    allowedSubroles: ["analyst"],
    defaultSubrole: "analyst",
  });
  accounts.setAccess(bob.user.id, {
    allowedSubroles: ["developer"],
    defaultSubrole: "developer",
  });
  const access = new QaAccessService(ctx, {
    accounts: () => accounts,
    config: () =>
      resolveConfig({
        lockdown: { toolPolicy: { allow: [...(catalog.pinned ?? [])] } },
      }),
    logger,
    repository: roles,
  });
  const quality = new QaQualityStore(path.join(root, "quality.json"));
  const conversations: Record<string, StoredSessionEvent[]> = {
    "session-alice": logFor(
      "Release report",
      "Build the release report",
      "Here is the report",
    ),
    "session-bob": logFor("SQL migration", "Write the migration", "Done"),
  };
  const service = new QaAdminService({
    accounts: () => accounts,
    quality: () => quality,
    roles: () => roles,
    access: () => access,
    sessionLog: staticSessionLogReader({
      sessions: [
        {
          id: "session-alice",
          createdAt: 1_700_000_000_000,
          agentPreset: "qa-research",
        },
        { id: "session-bob", createdAt: 1_700_000_100_000 },
        ...(catalog.extraSessions ?? []),
      ],
      events: conversations,
      ...(catalog.held === undefined ? {} : { held: catalog.held }),
    }),
    ...(catalog.sessionFiles === undefined
      ? {}
      : { sessionFiles: catalog.sessionFiles }),
    ...(catalog.droppedSources === undefined
      ? {}
      : {
          dropSources: (sessionId: string) => {
            catalog.droppedSources?.push(sessionId);
          },
        }),
    logger,
  });
  accounts.reserveSession(alice.token, "session-alice", {
    subroleId: "analyst",
  });
  accounts.reserveSession(bob.token, "session-bob", { subroleId: "developer" });
  return {
    service,
    accounts,
    quality,
    roles,
    admin,
    reviewer,
    alice,
    bob,
  };
}

export function refusal(
  call: () => Promise<unknown>,
): Promise<QaAccountsError> {
  return call().then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error as QaAccountsError,
  );
}

/**
 * A stored-session removal the fixture can inspect: it removes what the
 * deployment's listing holds and reports the rest as absent, which is how the
 * directory-backed eraser answers.
 */
export function fakeEraser(listed: readonly string[]): QaStoredSessionEraser & {
  readonly calls: readonly (readonly string[])[];
} {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    erase: async (sessionIds: readonly string[]) => {
      calls.push([...sessionIds]);
      return {
        removed: sessionIds.filter((sessionId) => listed.includes(sessionId)),
        absent: sessionIds.filter((sessionId) => !listed.includes(sessionId)),
      };
    },
  };
}
