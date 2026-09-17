import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QaAccounts, QaAccountsError } from "../src/accounts/store.js";
import { QaAccessService } from "../src/access/service.js";
import { QaRoleRepository } from "../src/access/role-repository.js";
import type { QaSessionLogReader } from "../src/admin/session-log.js";
import { resolveConfig } from "../src/resolve-config.js";

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
  const skills = new Map([
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
  ] as const);
  const ctx = {
    tools: {
      schemas: () =>
        [...tools].map((name) => ({ name, description: name, parameters: {} })),
    },
    get: (name: string) =>
      name === "skills"
        ? {
            snapshot: async () => ({
              skills: [...skills.values()],
              complete: true,
            }),
          }
        : undefined,
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
    ...(options.sessionLog === undefined
      ? {}
      : { sessionLog: options.sessionLog }),
    ...(options.onVanishedSessions === undefined
      ? {}
      : { onVanishedSessions: options.onVanishedSessions }),
  });
  return { service, accounts, admin, user, tools, skills };
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
    list: async () => ({ headers, complete: true }),
    read: async () => ({ ok: false as const, reason: "storage-unavailable" }),
  };
}

describe("QA access service", () => {
  it("keeps admin authorization separate from agent roles", async () => {
    const { service, admin, user } = harness();
    service.createSubrole(admin.token, {
      id: "analyst",
      name: "Analyst",
      enabled: true,
      capabilities: {
        tools: { always: ["analytics"], skillGrantable: [] },
        skills: ["data-analysis"],
      },
    });
    expect(service.current(admin.token).subroles.map(({ id }) => id)).toEqual([
      "general",
    ]);
    expect(() =>
      service.createSubrole(user.token, {
        id: "sales",
        name: "Sales",
        enabled: true,
        capabilities: {
          tools: { always: [], skillGrantable: [] },
          skills: [],
        },
      }),
    ).toThrow(QaAccountsError);
    await expect(service.adminSnapshot(user.token)).rejects.toThrow(
      QaAccountsError,
    );
  });

  it("refuses a role not assigned to the user", () => {
    const { service, admin, user } = harness();
    service.createSubrole(admin.token, {
      id: "developer",
      name: "Developer",
      enabled: true,
      capabilities: {
        tools: { always: ["git"], skillGrantable: [] },
        skills: [],
      },
    });
    expect(() =>
      service.reserveSession(
        user.token,
        "session-forbidden",
        "developer",
        false,
      ),
    ).toThrow(/not assigned/u);
    expect(() =>
      service.reserveSession(user.token, "session-preview", "developer", true),
    ).toThrow(/admin/u);
  });

  it("freezes policy per session and default-denies later capabilities", async () => {
    const { service, accounts, admin, user, tools } = harness();
    service.createSubrole(admin.token, {
      id: "analyst",
      name: "Analyst",
      enabled: true,
      capabilities: {
        tools: { always: ["analytics", "missing_tool"], skillGrantable: [] },
        skills: ["data-analysis", "missing-skill"],
      },
    });
    service.updateCommon(admin.token, {
      tools: { always: ["search"], skillGrantable: [] },
      skills: ["company"],
    });
    service.updateAssignment(admin.token, user.user.id, {
      allowedSubroles: ["analyst"],
      defaultSubrole: "analyst",
    });
    service.reserveSession(user.token, "session-a", "analyst", false);
    const first = await service.policyForSession(
      user.token,
      "session-a",
      fakeAgent(),
    );
    expect(first?.policy.tools).toEqual([
      "read",
      "search",
      "analytics",
      "skill",
    ]);
    expect(first?.policy.missingTools).toContain("missing_tool");

    tools.add("new_tool");
    const role = service.roles
      .snapshot()
      .subroles.find(({ id }) => id === "analyst")!;
    service.updateSubrole(admin.token, "analyst", {
      ...role,
      capabilities: {
        ...role.capabilities,
        tools: {
          ...role.capabilities.tools,
          always: [...role.capabilities.tools.always, "new_tool"],
        },
      },
    });
    const sameSession = await service.policyForSession(
      user.token,
      "session-a",
      fakeAgent(),
    );
    expect(sameSession?.policy.tools).not.toContain("new_tool");

    service.reserveSession(user.token, "session-b", "analyst", false);
    const nextSession = await service.policyForSession(
      user.token,
      "session-b",
      fakeAgent(),
    );
    expect(nextSession?.policy.tools).toContain("new_tool");
    expect(
      accounts.sessionAccess("session-a")?.capabilitySnapshot,
    ).toBeDefined();
  });

  it("records admin mutations in the audit trail", async () => {
    const { service, admin } = harness();
    service.createSubrole(admin.token, {
      id: "support",
      name: "Support",
      enabled: true,
      capabilities: {
        tools: { always: [], skillGrantable: [] },
        skills: [],
      },
    });
    const snapshot = await service.adminSnapshot(admin.token);
    expect(snapshot.audit.at(-1)).toMatchObject({
      actorId: admin.user.id,
      action: "subrole.created",
      targetId: "support",
    });
  });

  it("stores a skill overlay and clears it again", async () => {
    const { service, admin } = harness();
    service.createSubrole(admin.token, {
      id: "support",
      name: "Support",
      enabled: true,
      capabilities: {
        tools: { always: [], skillGrantable: [] },
        skills: [],
      },
    });
    const applied = service.updateSkillOverride(admin.token, {
      skillName: "company",
      addToSubroles: ["support"],
      forceCommon: true,
    });
    expect(applied).toEqual([
      {
        skillName: "company",
        addToSubroles: ["support"],
        forceCommon: true,
      },
    ]);
    expect(service.roles.snapshot().skillOverrides).toHaveLength(1);
    expect(service.roles.audit().at(-1)).toMatchObject({
      action: "skill.assignment-updated",
      targetId: "company",
    });

    const cleared = service.updateSkillOverride(admin.token, {
      skillName: "company",
    });
    expect(cleared).toEqual([]);
    expect(service.roles.snapshot().skillOverrides).toEqual([]);
  });

  it("reports skill rows and per-session activations to an admin", async () => {
    const { service, accounts, admin, user } = harness();
    service.updateAssignment(admin.token, user.user.id, {
      allowedSubroles: ["general"],
      defaultSubrole: "general",
    });
    service.reserveSession(user.token, "session-skills", null, false);
    const snapshot = await service.adminSnapshot(admin.token);
    expect(snapshot.skills.map(({ name }) => name)).toContain("company");
    // The skill declares no audience of its own, so it stays unassigned
    // until an administrator assigns it.
    expect(
      snapshot.skills.find(({ name }) => name === "company"),
    ).toMatchObject({
      health: "unassigned",
      visibleTo: [],
      disabled: false,
      overridden: false,
    });
    expect(snapshot.config.skillOverrides).toEqual([]);

    accounts.recordSkillActivation(
      "session-skills",
      {
        timestamp: "2026-09-15T00:00:00.000Z",
        skillName: "company",
        origin: "model",
        outcome: "activated",
        requestedTools: ["browser_open"],
        grantedTools: ["browser_open"],
        deniedTools: [],
      },
      100,
    );
    expect(
      service.skillActivations(admin.token, "session-skills"),
    ).toHaveLength(1);
    expect(() =>
      service.skillActivations(user.token, "session-skills"),
    ).toThrow(QaAccountsError);
  });

  it("keeps a delegated child out of the claim batch", () => {
    // The live registry proves the child; the store must never write the
    // ownership record that the admission refuses to create.
    const { service, accounts, user } = harness({
      live: new Map([
        ["session-child", { createdAt: Date.now(), parentSession: "s-root" }],
      ]),
    });

    expect(
      service.claimSessions(user.token, [
        "session-chat",
        "session-child",
        "session-chat",
      ]),
    ).toEqual({ claimed: 1, conflicts: [] });
    expect(accounts.ownedSessionIds(user.token)).toEqual(["session-chat"]);
  });

  it("reclaims ownership of a child the Host only knows from its log", async () => {
    // Residue of the releases that had no lineage check: the record exists,
    // the session is durable (nothing live to ask about it), and the child was
    // claimed by whoever opened its transcript.
    const { service, accounts, user } = harness({
      sessionLog: reader([
        { id: "session-child", createdAt: 1, parentSessionId: "s-root" },
        { id: "session-chat", createdAt: 2 },
      ]),
    });
    accounts.claimSessions(user.token, ["session-child", "session-chat"]);

    await service.reclaimDelegatedSessions();

    expect(accounts.ownedSessionIds(user.token)).toEqual(["session-chat"]);
    // The listing is remembered, so the answer no longer needs the registry.
    expect(service.isDelegatedChild("session-child")).toBe(true);
    expect(service.isDelegatedChild("session-chat")).toBe(false);
  });

  it("reclaims nothing when the durable listing cannot be read", async () => {
    const { service, accounts, user } = harness({
      sessionLog: {
        list: async () => {
          throw new Error("no query engine");
        },
        read: async () => ({
          ok: false as const,
          reason: "storage-unavailable",
        }),
      },
    });
    accounts.claimSessions(user.token, ["session-child"]);

    await service.reclaimDelegatedSessions();

    // An unanswerable question is not a licence to delete an auth boundary.
    expect(accounts.ownedSessionIds(user.token)).toEqual(["session-child"]);
    expect(service.isDelegatedChild("session-child")).toBe(false);
  });
});

describe("QA access service: the vanished-chat sweep", () => {
  /** The tightest retention the resolver allows; the clock then passes it. */
  const retention = { ownershipGraceHours: 1, sweepIntervalMinutes: 1 };

  /** Two hours on: past the grace period and past the throttle window. */
  const later = (): void => {
    vi.setSystemTime(new Date("2026-09-18T11:00:00Z"));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T09:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the record of a chat only storage still knows", async () => {
    // Nobody has opened this chat since the restart, so the live store is
    // silent about it — but storage holds it, and a quiet chat is not a
    // deleted one. A sweep that asked the live store alone would drop it.
    const { service, accounts, user } = harness({
      sessionLog: reader([{ id: "session-cold", createdAt: 1 }]),
      retention,
    });
    accounts.reserveSession(user.token, "session-cold", {
      subroleId: "general",
    });
    later();

    await service.sweepVanishedOwnership();

    expect(accounts.ownedSessionIds(user.token)).toEqual(["session-cold"]);
  });

  it("reclaims the record of a chat the whole Harness lost, and reports it", async () => {
    const vanished: string[][] = [];
    const { service, accounts, user } = harness({
      sessionLog: reader([]),
      retention,
      onVanishedSessions: (sessionIds) => vanished.push([...sessionIds]),
    });
    accounts.reserveSession(user.token, "session-gone", {
      subroleId: "general",
    });
    later();

    await service.sweepVanishedOwnership();

    expect(accounts.ownedSessionIds(user.token)).toEqual([]);
    // The record is the auth boundary; what else the deployment kept about the
    // chat is the caller's to drop, and it is told exactly which ids.
    expect(vanished).toEqual([["session-gone"]]);
  });

  it("reclaims nothing against a listing that cannot see stored sessions", async () => {
    const { service, accounts, user } = harness({
      sessionLog: {
        list: async () => ({ headers: [], complete: false }),
        read: async () => ({
          ok: false as const,
          reason: "storage-unavailable",
        }),
      },
      retention,
    });
    accounts.reserveSession(user.token, "session-quiet", {
      subroleId: "general",
    });
    later();

    await service.sweepVanishedOwnership();

    // An incomplete listing is an unanswerable question, not a deletion.
    expect(accounts.ownedSessionIds(user.token)).toEqual(["session-quiet"]);
  });
});
