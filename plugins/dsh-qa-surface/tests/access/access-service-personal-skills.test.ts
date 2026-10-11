import { describe, expect, it } from "vitest";
import { fakeAgent, harness, personal } from "./access-service.helpers.js";

/**
 * The same policy object answers the palette, the typed `/name` and the
 * enforcement guard, so one test over the session policy is the whole
 * consistency claim of #252 model (a).
 */
describe("the personal layer of a session policy", () => {
  it("reaches the owner's user list without a role grant", async () => {
    const { service, user, skills } = harness();
    personal(skills, "my-notes");
    service.reserveSession(user.token, "session-a", null, false);
    const resolved = await service.policyForSession(
      user.token,
      "session-a",
      fakeAgent(),
    );
    // `company` is installed and user-invocable too, and the default role names
    // no skill at all: only what this account owns joins its own list.
    expect(resolved?.policy.userSkills).toEqual(["my-notes"]);
    expect(resolved?.policy.skills).toEqual([]);
    expect(resolved?.policy.grantableTools).toEqual([]);
  });

  it("follows the account's own skills while the chat stays open", async () => {
    const { service, user, skills } = harness();
    personal(skills, "my-notes");
    service.reserveSession(user.token, "session-a", null, false);
    await service.policyForSession(user.token, "session-a", fakeAgent());

    personal(skills, "my-drafts");
    const added = await service.policyForSession(
      user.token,
      "session-a",
      fakeAgent(),
    );
    expect([...(added?.policy.userSkills ?? [])].sort()).toEqual([
      "my-drafts",
      "my-notes",
    ]);

    skills.delete("my-notes");
    const removed = await service.policyForSession(
      user.token,
      "session-a",
      fakeAgent(),
    );
    expect(removed?.policy.userSkills).toEqual(["my-drafts"]);
  });

  it("reaches a chat that already froze the personal name", async () => {
    const { service, admin, user, skills } = harness();
    personal(skills, "my-notes");
    service.reserveSession(user.token, "session-a", null, false);
    await service.policyForSession(user.token, "session-a", fakeAgent());
    service.updateSkillOverride(admin.token, {
      skillName: "my-notes",
      disabled: true,
    });

    // The withdrawal names the skill for everyone, its owner included, so a
    // chat started after it cannot invoke the name at all...
    service.reserveSession(user.token, "session-b", null, false);
    const next = await service.policyForSession(
      user.token,
      "session-b",
      fakeAgent(),
    );
    expect(next?.policy.userSkills).toEqual([]);
    // ...and it does not have to wait for the next chat either: the frozen list
    // carries the account's own names, and the withdrawn one is dropped from it.
    const frozen = await service.policyForSession(
      user.token,
      "session-a",
      fakeAgent(),
    );
    expect(frozen?.policy.userSkills).toEqual([]);
  });

  it("keeps a role-granted skill frozen while the personal layer moves", async () => {
    const { service, admin, user, skills } = harness();
    personal(skills, "my-notes");
    service.createSubrole(admin.token, {
      id: "analyst",
      name: "Analyst",
      enabled: true,
      capabilities: {
        tools: { always: ["analytics"], skillGrantable: [] },
        skills: ["company"],
      },
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
    expect(first?.policy.userSkills).toEqual(["company", "my-notes"]);

    // The role list grows afterwards: the chat keeps the snapshot it started
    // with, while the account's own skill is still its own.
    const role = service.roles
      .snapshot()
      .subroles.find(({ id }) => id === "analyst")!;
    service.updateSubrole(admin.token, "analyst", {
      ...role,
      capabilities: {
        ...role.capabilities,
        skills: [...role.capabilities.skills, "data-analysis"],
      },
    });
    personal(skills, "my-drafts");
    const next = await service.policyForSession(
      user.token,
      "session-a",
      fakeAgent(),
    );
    expect(next?.policy.skills).toEqual(["company"]);
    expect([...(next?.policy.userSkills ?? [])].sort()).toEqual([
      "company",
      "my-drafts",
      "my-notes",
    ]);
  });

  it("leaves a withdrawn role grant to the frozen snapshot", async () => {
    const { service, admin, user, skills } = harness();
    personal(skills, "my-notes");
    service.createSubrole(admin.token, {
      id: "analyst",
      name: "Analyst",
      enabled: true,
      capabilities: {
        tools: { always: ["analytics"], skillGrantable: [] },
        skills: ["company"],
      },
    });
    service.updateAssignment(admin.token, user.user.id, {
      allowedSubroles: ["analyst"],
      defaultSubrole: "analyst",
    });
    service.reserveSession(user.token, "session-a", "analyst", false);
    await service.policyForSession(user.token, "session-a", fakeAgent());
    service.updateSkillOverride(admin.token, {
      skillName: "company",
      disabled: true,
    });

    const frozen = await service.policyForSession(
      user.token,
      "session-a",
      fakeAgent(),
    );
    // The account's own name leaves with the withdrawal; the role's half of the
    // list is the snapshot the chat started with, and it stays that way.
    expect(frozen?.policy.userSkills).toEqual(["company", "my-notes"]);
    service.reserveSession(user.token, "session-b", "analyst", false);
    const next = await service.policyForSession(
      user.token,
      "session-b",
      fakeAgent(),
    );
    // A chat started after the withdrawal resolves the role list without it.
    expect(next?.policy.userSkills).toEqual(["my-notes"]);
  });
});
