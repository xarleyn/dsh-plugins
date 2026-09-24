import { describe, expect, it } from "vitest";
import {
  normalizeCapabilityConfig,
  normalizeUserAccess,
  resolveCapabilityPolicy,
} from "../../src/access/model.js";
import { qaToolDenial } from "../../src/lockdown-policy.js";
import {
  config,
  INSTALLED_SKILLS,
  INSTALLED_TOOLS,
} from "./access-policy.helpers.js";

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
      deny: [],
    });
    expect(legacy.subroles[0]?.capabilities.tools).toEqual({
      always: ["read"],
      skillGrantable: [],
      deny: [],
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
