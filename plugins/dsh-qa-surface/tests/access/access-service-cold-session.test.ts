import { describe, expect, it } from "vitest";
import type { SkillSummary } from "@deepseek-ai/dsh-skill";
import { userInvocableSkillNames } from "../../src/access/model.js";
import { fakeAgent, harness } from "./access-service.helpers.js";

/**
 * The slash palette is the one surface that names a chat's skills to a person
 * before that chat has run. A read for a chat nobody has woken answered "the
 * role system has no opinion", so the palette was narrowed by the deployment's
 * allow-list alone and could offer a name this very chat is not allowed to
 * invoke. These tests hold the two reads to the list the typed gesture is
 * admitted by.
 */

/** A skill no role and no common section names, invocable by a person. */
const UNGRANTED: SkillSummary = {
  name: "ungranted",
  description: "Granted to nobody",
  invocation: { modelInvocable: true, userInvocable: true },
  source: "runtime",
  provider: "test",
};

function world() {
  const h = harness();
  const { service, admin, user } = h;
  service.createSubrole(admin.token, {
    id: "analyst",
    name: "Analyst",
    enabled: true,
    capabilities: {
      tools: { always: ["analytics"], skillGrantable: [] },
      skills: ["data-analysis"],
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
  h.skills.set(UNGRANTED.name, UNGRANTED);
  return h;
}

describe("QA access service for a chat with no live agent", () => {
  it("narrows a cold chat by the role it will run under", async () => {
    const { service, user } = world();
    service.reserveSession(user.token, "session-cold", "analyst", false);
    const grant = userInvocableSkillNames(
      await service.policyForColdSession(user.token, "session-cold"),
    );
    expect(grant).toEqual(["company", "data-analysis"]);
    expect(grant).not.toContain(UNGRANTED.name);
  });

  it("names the same skills as the read of a woken chat", async () => {
    const { service, user } = world();
    service.reserveSession(user.token, "session-same", "analyst", false);
    const cold = userInvocableSkillNames(
      await service.policyForColdSession(user.token, "session-same"),
    );
    const live = userInvocableSkillNames(
      (await service.policyForSession(user.token, "session-same", fakeAgent()))!
        .policy,
    );
    expect(cold).toEqual(live);
  });

  it("keeps a foreign browser from reading the role at all", async () => {
    const { service, user } = world();
    service.reserveSession(user.token, "session-foreign", "analyst", false);
    await expect(
      service.policyForColdSession("not-a-token", "session-foreign"),
    ).rejects.toThrow(/account token/u);
  });

  it("freezes nothing onto the record a palette read touched", async () => {
    const { service, accounts, user } = world();
    service.reserveSession(user.token, "session-unpinned", "analyst", false);
    await service.policyForColdSession(user.token, "session-unpinned");
    expect(accounts.sessionAccess("session-unpinned")?.subroleId).toBe(
      "analyst",
    );
    expect(
      accounts.sessionAccess("session-unpinned")?.capabilitySnapshot,
    ).toBeUndefined();
    // The read of a woken chat still does what it always did.
    await service.policyForSession(user.token, "session-unpinned", fakeAgent());
    expect(
      accounts.sessionAccess("session-unpinned")?.capabilitySnapshot,
    ).toBeDefined();
  });

  it("falls back to the model-facing list when the role keeps no user list", async () => {
    const { service, admin, user, skills } = harness();
    // A skill invocable by the model and by nobody else: the policy the chat
    // resolves to carries an empty user list, which means the role declared no
    // separate one — not that a person may invoke nothing.
    skills.set("model-only", {
      name: "model-only",
      description: "Model only",
      invocation: { modelInvocable: true, userInvocable: false },
      source: "runtime",
      provider: "test",
    });
    service.createSubrole(admin.token, {
      id: "reporter",
      name: "Reporter",
      enabled: true,
      capabilities: {
        tools: { always: [], skillGrantable: [] },
        skills: ["model-only"],
      },
    });
    service.updateAssignment(admin.token, user.user.id, {
      allowedSubroles: ["reporter"],
      defaultSubrole: "reporter",
    });
    service.reserveSession(user.token, "session-model-only", "reporter", false);
    const policy = await service.policyForColdSession(
      user.token,
      "session-model-only",
    );
    expect(policy.userSkills).toEqual([]);
    expect(userInvocableSkillNames(policy)).toEqual(["model-only"]);
  });
});
