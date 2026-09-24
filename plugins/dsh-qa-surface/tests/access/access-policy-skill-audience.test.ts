import { describe, expect, it } from "vitest";
import { resolveCapabilityPolicy } from "../../src/access/model.js";
import type { QaSkillDescriptor } from "../../src/types.js";
import {
  config,
  descriptor,
  INSTALLED_SKILLS,
  INSTALLED_TOOLS,
} from "./access-policy.helpers.js";

describe("skill audience resolution", () => {
  const metadata = new Map<string, QaSkillDescriptor>([
    [
      "browser-research",
      descriptor("browser-research", {
        version: 1,
        audience: { type: "subroles", include: ["analyst", "banana-role"] },
        tools: { requires: ["browser_open", "shell"] },
      }),
    ],
    [
      "company",
      descriptor("company", { version: 1, audience: { type: "common" } }),
    ],
    ["legacy-skill", descriptor("legacy-skill", undefined)],
  ]);

  function policyFor(subroleId: string, overrides = config.skillOverrides) {
    return resolveCapabilityPolicy({
      config: { ...config, skillOverrides: overrides },
      subroleId,
      systemTools: [],
      systemSkills: [],
      available: { tools: INSTALLED_TOOLS, skills: INSTALLED_SKILLS },
      skillMetadata: metadata,
      revision: "rev-1",
    });
  }

  it("exposes a declared skill only to the roles it names", () => {
    const analyst = policyFor("analyst");
    const developer = policyFor("developer");

    expect(analyst.skills).toContain("browser-research");
    // `company` declares itself common, so both are declared assignments.
    expect(analyst.sources.declaredSkills).toEqual([
      "browser-research",
      "company",
    ]);
    expect(developer.skills).not.toContain("browser-research");
    expect(analyst.policyRevision).toBe("rev-1");
  });

  it("never exposes a skill that declares no qa-surface metadata", () => {
    expect(policyFor("analyst").skills).not.toContain("legacy-skill");
    expect(policyFor("developer").skills).not.toContain("legacy-skill");
  });

  it("lets an administrator add a skill the metadata assigned to nobody", () => {
    const analyst = policyFor("analyst", [
      { skillName: "legacy-skill", addToSubroles: ["analyst"] },
    ]);
    expect(analyst.skills).toContain("legacy-skill");
  });

  it("lets an explicit withdrawal beat the declared audience", () => {
    const analyst = policyFor("analyst", [
      { skillName: "browser-research", removeFromSubroles: ["analyst"] },
    ]);
    const developer = policyFor("developer", [
      { skillName: "company", forceCommon: true },
    ]);
    expect(analyst.skills).not.toContain("browser-research");
    // forceCommon adds, it never removes: the role list still applies.
    expect(developer.skills).toContain("company");
  });

  it("hides a disabled skill from every role", () => {
    const analyst = policyFor("analyst", [
      { skillName: "company", disabled: true },
    ]);
    expect(analyst.skills).not.toContain("company");
  });
});
