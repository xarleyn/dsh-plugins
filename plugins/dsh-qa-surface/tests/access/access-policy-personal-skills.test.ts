import { describe, expect, it } from "vitest";
import {
  normalizeCapabilityConfig,
  personalUserSkillNames,
  resolveCapabilityPolicy,
} from "../../src/access/model.js";
import {
  INSTALLED_SKILLS,
  INSTALLED_TOOLS,
  config,
} from "./access-policy.helpers.js";

/**
 * Model (a) of #252: the account's own skills are its user-invoke list's
 * personal layer, so a skill a person keeps in their own directory is theirs
 * without an administrator having to name it in a shared role.
 */
const withPersonal = normalizeCapabilityConfig({
  version: 1,
  common: {
    tools: { always: ["search"], skillGrantable: [] },
    skills: [],
  },
  subroles: [
    {
      id: "analyst",
      name: "Analyst",
      enabled: true,
      capabilities: {
        tools: { always: [], skillGrantable: [] },
        skills: ["data-analysis"],
      },
    },
  ],
  skillOverrides: [{ skillName: "retired-notes", disabled: true }],
});

const resolve = (ownSkills: ReadonlySet<string>, target = withPersonal) =>
  resolveCapabilityPolicy({
    config: target,
    subroleId: "analyst",
    systemTools: [],
    systemSkills: [],
    available: {
      tools: INSTALLED_TOOLS,
      skills: INSTALLED_SKILLS,
      userSkills: new Set([...INSTALLED_SKILLS, "my-notes", "my-drafts"]),
      ownSkills,
    },
  });

describe("the personal layer of one session's user skills", () => {
  it("joins the user list without touching the model's catalog", () => {
    const policy = resolve(new Set(["my-notes", "my-drafts"]));
    expect(policy.userSkills).toEqual([
      "data-analysis",
      "my-drafts",
      "my-notes",
    ]);
    // The role grants this account exactly one visible skill, and a personal
    // skill never becomes the model's for being the account's.
    expect(policy.skills).toEqual(["data-analysis"]);
    expect(policy.sources.declaredSkills).toEqual([]);
  });

  it("keeps the role's tool ceiling over what a personal skill may grant", () => {
    const policy = resolve(new Set(["my-notes"]));
    expect(policy.tools).toEqual(["search", "skill"]);
    expect(policy.grantableTools).toEqual([]);
  });

  it("carries a name the account owns over what the administrator withdrew", () => {
    const policy = resolve(new Set(["my-notes", "retired-notes"]));
    expect(policy.userSkills).toEqual(["data-analysis", "my-notes"]);
  });

  it("drops a personal name that is not invocable by a person at all", () => {
    // The catalog reads `ownSkills` off user-invocable discoveries, so this is
    // the fail-closed reading for a caller that hands over anything else.
    const policy = resolve(new Set(["missing-skill"]));
    expect(policy.userSkills).toEqual(["data-analysis"]);
  });

  it("grants nothing personal when the session has no own skills", () => {
    const policy = resolve(new Set());
    expect(policy.userSkills).toEqual(["data-analysis"]);
    expect(personalUserSkillNames(withPersonal, undefined)).toEqual([]);
  });

  it("is bound by an outright withdrawal and by nothing else in the overlay", () => {
    const overlaid = normalizeCapabilityConfig({
      version: 1,
      common: { tools: { always: [], skillGrantable: [] }, skills: [] },
      subroles: [
        {
          id: "analyst",
          name: "Analyst",
          enabled: true,
          capabilities: {
            tools: { always: [], skillGrantable: [] },
            skills: [],
          },
        },
      ],
      skillOverrides: [
        // A role-audience edit names roles; the personal layer is not one.
        { skillName: "my-notes", removeFromSubroles: ["analyst"] },
        { skillName: "my-drafts", disabled: true },
      ],
    });
    expect(
      personalUserSkillNames(overlaid, new Set(["my-notes", "my-drafts"])),
    ).toEqual(["my-notes"]);
  });

  it("leaves an unassigned deployment's policy as it was", () => {
    const policy = resolveCapabilityPolicy({
      config,
      subroleId: "analyst",
      systemTools: [],
      systemSkills: [],
      available: { tools: INSTALLED_TOOLS, skills: INSTALLED_SKILLS },
    });
    expect(policy.userSkills).toEqual(["company", "data-analysis"]);
  });
});
