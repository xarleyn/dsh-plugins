import { describe, expect, it } from "vitest";
import {
  parseQaSkillMetadata,
  resolveSkillVisibility,
  skillHealth,
  unassignedSkill,
} from "../src/access/skill-metadata.js";

const ROLES = new Set(["analyst", "presales", "developer"]);

function parse(raw: unknown, known = ROLES) {
  return parseQaSkillMetadata(
    "browser-research",
    raw === undefined ? undefined : { "qa-surface": raw },
    known,
  );
}

describe("qa-surface skill metadata", () => {
  it("treats a skill without the block as unassigned with no requirements", () => {
    const plain = parse(undefined);
    expect(plain).toMatchObject({
      declared: false,
      requireAll: false,
      requiredTools: [],
      audience: { type: "unassigned" },
    });
    expect(plain.warnings).toEqual([]);
    expect(unassignedSkill("x").declared).toBe(false);
  });

  it("reads a common audience and a session lifecycle", () => {
    expect(parse({ version: 1, audience: { type: "common" } })).toMatchObject({
      declared: true,
      schemaVersion: 1,
      lifecycle: "session",
      audience: { type: "common" },
    });
  });

  it("drops an unknown subrole instead of the whole skill", () => {
    const descriptor = parse({
      version: 1,
      audience: { type: "subroles", include: ["analyst", "banana-role"] },
    });
    expect(descriptor.audience).toEqual({
      type: "subroles",
      include: ["analyst"],
    });
    expect(descriptor.warnings).toEqual(["unknown subrole: banana-role"]);
  });

  it("turns an audience with no known role into unassigned", () => {
    const descriptor = parse({
      version: 1,
      audience: { type: "subroles", include: ["banana-role"] },
    });
    expect(descriptor.audience).toEqual({ type: "unassigned" });
    expect(descriptor.warnings).toEqual([
      "unknown subrole: banana-role",
      "audience lists no known subrole",
    ]);
  });

  it("reads tool requirements and the strict flag", () => {
    const descriptor = parse({
      version: 1,
      tools: {
        requires: ["browser_open", "browser_click"],
        grant: { lifecycle: "session", requireAll: true },
      },
    });
    expect(descriptor.requiredTools).toEqual(["browser_open", "browser_click"]);
    expect(descriptor.requireAll).toBe(true);
    expect(descriptor.warnings).toEqual([]);
  });

  it("refuses an unsupported metadata version instead of guessing", () => {
    const descriptor = parse({
      version: 2,
      audience: { type: "common" },
      tools: { requires: ["shell"] },
    });
    expect(descriptor.declared).toBe(true);
    expect(descriptor.audience).toEqual({ type: "unassigned" });
    expect(descriptor.requiredTools).toEqual([]);
    expect(descriptor.warnings).toEqual([
      "unsupported qa-surface metadata version: 2",
    ]);
  });

  it("keeps a best-effort skill readable when fields are malformed", () => {
    const descriptor = parse({
      version: 1,
      audience: "everyone",
      tools: {
        requires: ["", 7, "browser_open"],
        grant: { lifecycle: "turn", requireAll: "yes" },
      },
    });
    expect(descriptor.audience).toEqual({ type: "unassigned" });
    expect(descriptor.requiredTools).toEqual(["browser_open"]);
    expect(descriptor.requireAll).toBe(false);
    expect(descriptor.lifecycle).toBe("session");
    expect(descriptor.warnings).toEqual([
      "audience must be an object",
      'tools.requires contains an invalid id: ""',
      "tools.requires contains an invalid id: 7",
      "tools.grant.requireAll must be a boolean",
      'unsupported grant lifecycle: "turn"; using session',
    ]);
  });
});

describe("skill visibility overlay", () => {
  const declared = parse({
    version: 1,
    audience: { type: "subroles", include: ["analyst", "presales"] },
  });

  it("expands the declared audience when the administrator adds a role", () => {
    const visibility = resolveSkillVisibility(
      declared,
      {
        skillName: "browser-research",
        addToSubroles: ["developer"],
      },
      ["analyst", "presales", "developer"],
    );
    expect(visibility.visibleTo).toEqual(["analyst", "presales", "developer"]);
    expect(visibility.declaredTo).toEqual(["analyst", "presales"]);
    expect(visibility.overridden).toBe(true);
  });

  it("reports no override when the overlay changes nothing", () => {
    const visibility = resolveSkillVisibility(
      declared,
      {
        skillName: "browser-research",
        addToSubroles: ["presales"],
      },
      ["analyst", "presales", "developer"],
    );
    expect(visibility.overridden).toBe(false);
    expect(visibility.visibleTo).toEqual(["analyst", "presales"]);
  });

  it("removes a declared role and never resurrects it through add", () => {
    const visibility = resolveSkillVisibility(
      declared,
      {
        skillName: "browser-research",
        addToSubroles: ["presales"],
        removeFromSubroles: ["presales"],
      },
      ["analyst", "presales", "developer"],
    );
    expect(visibility.visibleTo).toEqual(["analyst"]);
    expect(visibility.overridden).toBe(true);
  });
});

describe("skill health", () => {
  const strict = parse({
    version: 1,
    audience: { type: "common" },
    tools: { requires: ["browser_open"], grant: { requireAll: true } },
  });
  const bestEffort = parse({
    version: 1,
    audience: { type: "common" },
    tools: { requires: ["browser_open"] },
  });

  it("distinguishes blocked from degraded by the strict flag", () => {
    expect(skillHealth(strict, 0, 1, ["analyst"])).toBe("blocked");
    expect(skillHealth(bestEffort, 0, 1, ["analyst"])).toBe("degraded");
    expect(skillHealth(strict, 1, 0, ["analyst"])).toBe("healthy");
  });

  it("reports a skill nobody sees as unassigned", () => {
    expect(skillHealth(bestEffort, 0, 0, [])).toBe("unassigned");
    expect(skillHealth(bestEffort, 0, 0, ["analyst"])).toBe("healthy");
  });
});
