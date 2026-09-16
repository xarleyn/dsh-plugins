import { describe, expect, it } from "vitest";
import {
  normalizeCapabilityConfig,
  normalizeUserAccess,
  resolveCapabilityPolicy,
  resolveSkillAccess,
} from "../src/access/model.js";
import { parseQaSkillMetadata } from "../src/access/skill-metadata.js";
import { qaToolDenial } from "../src/lockdown-policy.js";
import type { QaSkillDescriptor } from "../src/types.js";

const ROLES = new Set(["analyst", "developer"]);

function descriptor(
  name: string,
  raw: Readonly<Record<string, unknown>> | undefined,
): QaSkillDescriptor {
  return parseQaSkillMetadata(
    name,
    raw === undefined ? undefined : { "qa-surface": raw },
    ROLES,
  );
}

const config = normalizeCapabilityConfig({
  version: 1,
  common: {
    tools: { always: ["search"], skillGrantable: ["browser_open"] },
    skills: ["company"],
  },
  subroles: [
    {
      id: "analyst",
      name: "Analyst",
      enabled: true,
      capabilities: {
        tools: { always: ["analytics", "missing_tool"], skillGrantable: [] },
        skills: ["data-analysis", "missing-skill"],
      },
    },
    {
      id: "developer",
      name: "Developer",
      enabled: true,
      capabilities: {
        tools: { always: ["git"], skillGrantable: ["browser_click"] },
        skills: ["code-review"],
      },
    },
  ],
  skillOverrides: [],
});

const INSTALLED_TOOLS = new Set([
  "read",
  "search",
  "analytics",
  "git",
  "skill",
  "browser_open",
  "browser_click",
]);
const INSTALLED_SKILLS = new Set([
  "company",
  "data-analysis",
  "code-review",
  "browser-research",
  "legacy-skill",
]);

describe("QA capability policy", () => {
  it("unions system, common and exactly one role", () => {
    const policy = resolveCapabilityPolicy({
      config,
      subroleId: "analyst",
      systemTools: ["read"],
      systemSkills: [],
      available: {
        tools: INSTALLED_TOOLS,
        skills: INSTALLED_SKILLS,
      },
    });

    expect(policy.tools).toEqual(["read", "search", "analytics", "skill"]);
    expect(policy.skills).toEqual(["company", "data-analysis"]);
    expect(policy.sources.commonTools).toEqual(["search"]);
    expect(policy.sources.roleTools).toEqual(["analytics"]);
    expect(policy.tools).not.toContain("git");
    expect(qaToolDenial(new Set(policy.tools), "git")).toMatch(
      /not available/u,
    );
  });

  it("keeps skill-grantable tools out of the first model step", () => {
    const policy = resolveCapabilityPolicy({
      config,
      subroleId: "analyst",
      systemTools: [],
      systemSkills: [],
      available: { tools: INSTALLED_TOOLS, skills: INSTALLED_SKILLS },
    });

    expect(policy.tools).not.toContain("browser_open");
    expect(policy.grantableTools).toEqual(["browser_open"]);
    expect(policy.sources.commonGrantableTools).toEqual(["browser_open"]);
    expect(policy.sources.roleGrantableTools).toEqual([]);
  });

  it("retains unknown selections as missing without granting them", () => {
    const policy = resolveCapabilityPolicy({
      config,
      subroleId: "analyst",
      systemTools: [],
      systemSkills: [],
      available: {
        tools: new Set(["search", "analytics", "skill"]),
        skills: new Set(["company", "data-analysis"]),
      },
    });

    expect(policy.missingTools).toEqual(["missing_tool", "browser_open"]);
    expect(policy.missingSkills).toEqual(["missing-skill"]);
    expect(policy.tools).not.toContain("missing_tool");
    expect(policy.skills).not.toContain("missing-skill");
  });

  it("does not union capabilities of several assigned roles", () => {
    const assignment = normalizeUserAccess(
      {
        allowedSubroles: ["analyst", "developer"],
        defaultSubrole: "analyst",
      },
      config,
    );
    const policy = resolveCapabilityPolicy({
      config,
      subroleId: assignment.defaultSubrole,
      systemTools: [],
      systemSkills: [],
      available: { tools: INSTALLED_TOOLS, skills: INSTALLED_SKILLS },
    });
    expect(policy.tools).not.toContain("git");
    expect(policy.grantableTools).not.toContain("browser_click");
    expect(policy.skills).not.toContain("code-review");
  });

  it("reads the legacy flat tool list as always visible", () => {
    const legacy = normalizeCapabilityConfig({
      version: 1,
      common: { tools: ["search"], skills: [] },
      subroles: [
        {
          id: "general",
          name: "General",
          enabled: true,
          capabilities: { tools: ["read"], skills: [] },
        },
      ],
      skillOverrides: [],
    } as never);

    expect(legacy.common.tools).toEqual({
      always: ["search"],
      skillGrantable: [],
    });
    expect(legacy.subroles[0]?.capabilities.tools).toEqual({
      always: ["read"],
      skillGrantable: [],
    });
  });

  it("rejects duplicate ids and disabling every role", () => {
    expect(() =>
      normalizeCapabilityConfig({
        ...config,
        subroles: [config.subroles[0]!, config.subroles[0]!],
      }),
    ).toThrow(/unique/u);
    expect(() =>
      normalizeCapabilityConfig({
        ...config,
        subroles: config.subroles.map((role) => ({ ...role, enabled: false })),
      }),
    ).toThrow(/enabled/u);
  });
});

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

describe("administration skill projection", () => {
  const rows = [
    {
      type: "skill" as const,
      id: "browser-research",
      title: "browser-research",
      source: { kind: "filesystem" as const, name: "skill-filesystem" },
      status: "available" as const,
    },
  ];

  function access(overrides = config.skillOverrides) {
    return resolveSkillAccess({
      config: { ...config, skillOverrides: overrides },
      descriptors: new Map<string, QaSkillDescriptor>([
        [
          "browser-research",
          descriptor("browser-research", {
            version: 1,
            audience: { type: "subroles", include: ["analyst"] },
            tools: {
              requires: ["browser_open", "shell"],
              grant: { lifecycle: "session", requireAll: true },
            },
          }),
        ],
      ]),
      rows,
      installedTools: INSTALLED_TOOLS,
    });
  }

  it("reports the declared audience next to the effective one", () => {
    const [skill] = access();
    expect(skill?.visibleTo).toEqual(["analyst"]);
    expect(
      skill?.roles.find(({ roleId }) => roleId === "analyst"),
    ).toMatchObject({
      declared: true,
      visible: true,
      grantableTools: ["browser_open"],
      unavailableTools: ["shell"],
    });
  });

  it("blocks a strict skill whose required tool is unavailable", () => {
    const [skill] = access();
    expect(skill?.health).toBe("blocked");
    expect(skill?.tools.find(({ id }) => id === "shell")).toMatchObject({
      installed: false,
      grantableBy: [],
      blockedFor: ["analyst"],
    });
  });

  it("marks an administrator overlay as overriding", () => {
    const [skill] = access([
      { skillName: "browser-research", addToSubroles: ["developer"] },
    ]);
    expect(skill?.overridden).toBe(true);
    expect(skill?.visibleTo).toEqual(["analyst", "developer"]);
    expect(
      skill?.roles.find(({ roleId }) => roleId === "developer")?.addedByAdmin,
    ).toBe(true);
  });
});
