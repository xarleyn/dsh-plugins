import { describe, expect, it } from "vitest";
import {
  normalizeCapabilityConfig,
  normalizeUserAccess,
  resolveCapabilityPolicy,
} from "../src/access/model.js";
import { qaToolDenial } from "../src/lockdown-policy.js";

const config = normalizeCapabilityConfig({
  version: 1,
  common: { tools: ["search"], skills: ["company"] },
  subroles: [
    {
      id: "analyst",
      name: "Analyst",
      enabled: true,
      capabilities: {
        tools: ["analytics", "missing_tool"],
        skills: ["data-analysis", "missing-skill"],
      },
    },
    {
      id: "developer",
      name: "Developer",
      enabled: true,
      capabilities: { tools: ["git"], skills: ["code-review"] },
    },
  ],
});

describe("QA capability policy", () => {
  it("unions system, common and exactly one role", () => {
    const policy = resolveCapabilityPolicy({
      config,
      subroleId: "analyst",
      systemTools: ["read"],
      systemSkills: [],
      available: {
        tools: new Set(["read", "search", "analytics", "git", "skill"]),
        skills: new Set(["company", "data-analysis", "code-review"]),
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

    expect(policy.missingTools).toEqual(["missing_tool"]);
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
      available: {
        tools: new Set(["search", "analytics", "git", "skill"]),
        skills: new Set(["company", "data-analysis", "code-review"]),
      },
    });
    expect(policy.tools).not.toContain("git");
    expect(policy.skills).not.toContain("code-review");
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
