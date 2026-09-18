import { describe, expect, it } from "vitest";
import {
  normalizeCapabilityConfig,
  resolveCapabilityPolicy,
  roleGrantCeiling,
} from "../src/access/model.js";
import { INSTALLED_SKILLS, INSTALLED_TOOLS } from "./access-policy.helpers.js";

describe("withdrawing a tool from a profile", () => {
  const denied = normalizeCapabilityConfig({
    version: 1,
    common: {
      tools: { always: ["search"], skillGrantable: ["browser_open"] },
      skills: [],
    },
    subroles: [
      {
        id: "analyst",
        name: "Analyst",
        enabled: true,
        capabilities: {
          tools: {
            always: ["analytics"],
            skillGrantable: ["browser_click"],
            // `search` and `browser_open` are granted by Common, `read` by the
            // deployment: a denial is what takes any of them away.
            deny: ["search", "read", "browser_open"],
          },
          skills: [],
        },
      },
    ],
    skillOverrides: [],
  });

  const resolve = () =>
    resolveCapabilityPolicy({
      config: denied,
      subroleId: "analyst",
      systemTools: ["read", "glob"],
      systemSkills: [],
      available: {
        tools: INSTALLED_TOOLS,
        skills: INSTALLED_SKILLS,
      },
    });

  it("removes a name whatever grants it, pinned system tools included", () => {
    const policy = resolve();
    // `read` is pinned by the deployment and `search` by Common; both are gone,
    // and `glob` is not mounted in this deployment either, so it never appears.
    expect(policy.tools).toEqual(["analytics"]);
    expect(policy.tools).not.toContain("read");
    expect(policy.tools).not.toContain("search");
  });

  it("narrows the ceiling a skill may grant against", () => {
    const policy = resolve();
    expect(policy.grantableTools).toEqual(["browser_click"]);
    expect(policy.grantableTools).not.toContain("browser_open");
    expect(roleGrantCeiling(denied, "analyst")).toEqual(["browser_click"]);
  });

  it("keeps the denial visible in the configured sources", () => {
    const policy = resolve();
    expect(policy.sources.commonTools).toEqual(["search"]);
    expect(policy.sources.roleTools).toEqual(["analytics"]);
  });

  it("survives normalization from a stored profile without denials", () => {
    const legacy = normalizeCapabilityConfig({
      version: 1,
      common: { tools: { always: ["read"], skillGrantable: [] }, skills: [] },
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
      skillOverrides: [],
    });
    expect(legacy.common.tools.deny).toEqual([]);
    expect(legacy.subroles[0]?.capabilities.tools.deny).toEqual([]);
  });
});
