import { describe, expect, it, vi } from "vitest";
import { userInvocableSkillNames } from "../../src/access/model.js";
import { harness } from "./access-service.helpers.js";

async function world(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options);
  await h.service.createSubrole(h.admin.token, {
    id: "analyst",
    name: "Analyst",
    enabled: true,
    capabilities: {
      tools: { always: [], skillGrantable: [] },
      skills: ["data-analysis", "preset-search"],
    },
  });
  await h.service.updateAssignment(h.admin.token, h.user.user.id, {
    allowedSubroles: ["analyst"],
    defaultSubrole: "analyst",
  });
  return h;
}

describe("draft slash access preview", () => {
  it("resolves the role before a session exists, without reserving ownership", async () => {
    const h = await world();
    const reserve = vi.spyOn(h.accounts, "reserveSessionForUser");
    const value = await h.service.slashDraftSkills(h.user.token, null, false);
    expect(userInvocableSkillNames(value.policy!)).toEqual(["data-analysis"]);
    expect(value.skills.map((skill) => skill.name)).toContain("company");
    expect(reserve).not.toHaveBeenCalled();
  });
  it("keeps the preset scope lease for the read and includes its skill", async () => {
    const release = vi.fn(async () => {});
    const h = await world({
      presetScope: async () => ({ key: "preset-demo" as never, release }),
    });
    release.mockClear();
    const value = await h.service.slashDraftSkills(
      h.user.token,
      "analyst",
      false,
    );
    expect(value.skills.map((skill) => skill.name)).toContain("preset-search");
    expect(userInvocableSkillNames(value.policy!)).toContain("preset-search");
    expect(release).toHaveBeenCalledOnce();
  });
  it("refuses an expired token and a role outside the account assignment", async () => {
    const h = await world();
    await expect(
      h.service.slashDraftSkills("expired", null, false),
    ).rejects.toThrow(/account token/u);
    await expect(
      h.service.slashDraftSkills(h.user.token, "general", false),
    ).rejects.toThrow(/not assigned/u);
  });
  it("does not let an ordinary account grant itself administrator preview", async () => {
    const h = await world();
    await expect(
      h.service.slashDraftSkills(h.user.token, "general", true),
    ).rejects.toThrow(/admin account/u);
    expect(
      (await h.service.slashDraftSkills(h.admin.token, "analyst", true)).policy,
    ).toBeDefined();
  });
});
