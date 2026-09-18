import { describe, expect, it } from "vitest";
import { harness, refusal } from "./admin-service.helpers.js";

describe("admin user management", () => {
  it("lists accounts with their role, status and assignment counters", async () => {
    const { service, admin, alice } = harness();
    const page = await service.users(admin.token, {}, undefined, undefined);
    expect(page.total).toBe(4);
    const row = page.items.find((item) => item.id === alice.user.id);
    expect(row?.role).toBe("user");
    expect(row?.access.defaultSubrole).toBe("analyst");
    expect(row?.conversations).toBe(1);
    expect(row?.fullName).toBe("");
  });

  it("filters the list by role, status and subrole", async () => {
    const { service, admin } = harness();
    const reviewers = await service.users(
      admin.token,
      { role: "reviewer" },
      undefined,
      undefined,
    );
    expect(reviewers.items.map((row) => row.email)).toEqual([
      "reviewer@example.com",
    ]);
    const developers = await service.users(
      admin.token,
      { subroleId: "developer" },
      undefined,
      undefined,
    );
    expect(developers.items.map((row) => row.email)).toEqual([
      "bob@example.com",
    ]);
    expect(
      (
        await service.users(
          admin.token,
          { status: "disabled" },
          undefined,
          undefined,
        )
      ).total,
    ).toBe(0);
  });

  it("changes a role, disables an account and writes both to the audit", async () => {
    const { service, admin, alice, quality } = harness();
    const detail = await service.updateUser(admin.token, alice.user.id, {
      role: "reviewer",
      disabled: true,
    });
    expect(detail.user.role).toBe("reviewer");
    expect(detail.user.disabled).toBe(true);
    const actions = quality.auditEvents().map((event) => event.action);
    expect(actions).toContain("authorization.changed");
    expect(actions).toContain("user.disabled");
    // A disabled user keeps their history.
    const page = await service.conversations(
      admin.token,
      {},
      undefined,
      undefined,
    );
    expect(
      page.items.find((row) => row.conversationId === "session-alice"),
    ).toMatchObject({ displayName: "alice" });
  });

  it("refuses to leave the deployment without an enabled administrator", async () => {
    const { service, admin } = harness();
    expect(
      await refusal(() =>
        service.updateUser(admin.token, admin.user.id, { role: "user" }),
      ),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() =>
        service.updateUser(admin.token, admin.user.id, { disabled: true }),
      ),
    ).toMatchObject({ reason: "forbidden" });
  });

  it("refuses an assignment naming a role that does not exist", async () => {
    const { service, admin, alice } = harness();
    expect(
      await refusal(() =>
        service.updateUser(admin.token, alice.user.id, {
          access: { allowedSubroles: ["sales"], defaultSubrole: "sales" },
        }),
      ),
    ).toMatchObject({ reason: "invalid-role" });
  });

  it("refuses a wire role outside the role union and stores nothing", async () => {
    const { service, admin, alice } = harness();
    // The console sends a string over the wire; a hand-rolled request can
    // name a role the permission tables do not know.
    const garbage = "superadmin" as unknown as "user";
    expect(
      await refusal(() =>
        service.updateUser(admin.token, alice.user.id, { role: garbage }),
      ),
    ).toMatchObject({ reason: "invalid-role" });
    // The stored role is untouched, so every later permission check for the
    // account keeps resolving instead of crashing on the unknown key.
    const page = await service.users(admin.token, {}, undefined, undefined);
    expect(page.items.find((row) => row.id === alice.user.id)?.role).toBe(
      "user",
    );
  });
  it("subtracts a denied tool from both buckets and reports the denial", async () => {
    const { service, admin, alice, roles, accounts } = harness({
      // `git` is pinned by the deployment and `read` is granted by the role.
      pinned: ["git", "glob"],
      tools: ["git", "read", "ghost"],
    });
    roles.update(admin.user.id, "analyst", {
      id: "analyst",
      name: "Analyst",
      enabled: true,
      capabilities: {
        tools: {
          always: ["read"],
          skillGrantable: ["ghost"],
          deny: ["git", "ghost"],
        },
        skills: [],
      },
    });
    accounts.setAccess(alice.user.id, {
      allowedSubroles: ["analyst"],
      defaultSubrole: "analyst",
    });
    const detail = await service.user(admin.token, alice.user.id);
    expect(detail.effective).toEqual([
      {
        subroleId: "analyst",
        name: "Analyst",
        // The pinned git is withdrawn, the role's own read stays, and the
        // pinned glob is not mounted in this deployment.
        tools: 1,
        grantableTools: 0,
        // Both denied names are mounted, so both are worth reporting: the
        // denial is the part an operator can undo.
        deniedTools: 2,
        skills: 0,
      },
    ]);
  });

  it("reports the effective capability counts of each assigned role", async () => {
    const { service, admin, alice } = harness();
    const detail = await service.user(admin.token, alice.user.id);
    expect(detail.effective).toEqual([
      {
        subroleId: "analyst",
        name: "Analyst",
        tools: 0,
        grantableTools: 0,
        deniedTools: 0,
        skills: 0,
      },
    ]);
    expect(detail.activity.conversations).toBe(1);
    expect(detail.activity.messages).toBe(2);
  });

  it("counts the pinned tools a profile resolves, not only its own list", async () => {
    const { service, admin, alice } = harness({
      // Every session resolves the deployment's pinned set on top of the role:
      // reporting the configured lists alone read as "0 tools" for a profile
      // whose chats run with the whole pinned list.
      pinned: ["glob", "grep", "ask_user_question"],
      tools: ["glob", "grep", "read", "git"],
      skills: ["release-notes"],
      declared: [{ name: "sales-playbook", roles: ["analyst"] }],
    });
    const detail = await service.user(admin.token, alice.user.id);
    expect(detail.effective).toEqual([
      {
        subroleId: "analyst",
        name: "Analyst",
        // glob and grep are pinned and mounted, read is the role's own tool;
        // ask_user_question is pinned but unmounted, git is not configured.
        tools: 3,
        grantableTools: 0,
        deniedTools: 0,
        // The assigned skill and the one whose own SKILL.md names this role.
        skills: 2,
      },
    ]);
  });

  it("reports the skill-grantable ceiling apart from visible tools", async () => {
    const { service, admin, alice, roles, accounts } = harness({
      tools: ["git", "read"],
    });
    roles.update(admin.user.id, "developer", {
      id: "developer",
      name: "Developer",
      enabled: true,
      capabilities: {
        tools: { always: [], skillGrantable: ["git", "ghost"] },
        skills: [],
      },
    });
    accounts.setAccess(alice.user.id, {
      allowedSubroles: ["analyst", "developer"],
      defaultSubrole: "analyst",
    });
    const detail = await service.user(admin.token, alice.user.id);
    expect(detail.effective).toEqual([
      {
        subroleId: "analyst",
        name: "Analyst",
        tools: 1,
        grantableTools: 0,
        deniedTools: 0,
        skills: 0,
      },
      {
        subroleId: "developer",
        name: "Developer",
        // A grantable tool is a ceiling, not a visible tool: git counts there
        // and nowhere else, and ghost is not mounted at all.
        tools: 0,
        grantableTools: 1,
        deniedTools: 0,
        skills: 0,
      },
    ]);
  });
});
