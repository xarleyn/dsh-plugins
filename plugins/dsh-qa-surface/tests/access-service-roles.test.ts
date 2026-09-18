import { describe, expect, it } from "vitest";
import { QaAccountsError } from "../src/accounts/store.js";
import { fakeAgent, harness, reader } from "./access-service.helpers.js";
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
        live: () => false,
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
