import { describe, expect, it } from "vitest";
import {
  allowsSlashName,
  filterBySlashPolicy,
  intersectSlashNames,
  isQaSlashPolicyMode,
  normalizeSlashAllow,
} from "../../src/slash/policy.js";

const ENTRIES = [{ name: "a" }, { name: "b" }, { name: "c" }];

describe("slash policy", () => {
  it("denies everything in deny-all, whatever the list says", () => {
    const policy = { mode: "deny-all" as const, allow: ["a", "b"] };
    expect(allowsSlashName(policy, "a")).toBe(false);
    expect(filterBySlashPolicy(ENTRIES, policy)).toEqual([]);
  });

  it("admits exactly the named entries in allow-list", () => {
    const policy = { mode: "allow-list" as const, allow: ["a", "c"] };
    expect(allowsSlashName(policy, "b")).toBe(false);
    expect(filterBySlashPolicy(ENTRIES, policy)).toEqual([
      { name: "a" },
      { name: "c" },
    ]);
  });

  it("admits every discovered entry in all", () => {
    const policy = { mode: "all" as const, allow: [] };
    expect(allowsSlashName(policy, "anything")).toBe(true);
    expect(filterBySlashPolicy(ENTRIES, policy)).toBe(ENTRIES);
  });

  it("keeps a name-based allow-list readable for an operator", () => {
    expect(normalizeSlashAllow([" a ", "a", "", "b"], "test")).toEqual([
      "a",
      "b",
    ]);
    expect(normalizeSlashAllow(["generate-tkp"], "test")).toEqual([
      "generate-tkp",
    ]);
  });

  it("refuses a name neither native registry could carry", () => {
    expect(() =>
      normalizeSlashAllow(["Generate"], "slashCommands.skills"),
    ).toThrow(/lowercase/u);
    expect(() => normalizeSlashAllow(["/a"], "slashCommands.skills")).toThrow(
      /lowercase/u,
    );
    expect(() =>
      normalizeSlashAllow(["a".repeat(201)], "slashCommands.skills"),
    ).toThrow(/200/u);
  });

  it("recognises only the three documented modes", () => {
    expect(isQaSlashPolicyMode("deny-all")).toBe(true);
    expect(isQaSlashPolicyMode("allow-list")).toBe(true);
    expect(isQaSlashPolicyMode("all")).toBe(true);
    expect(isQaSlashPolicyMode("some")).toBe(false);
  });

  describe("role intersection", () => {
    it("leaves the list alone when the role system has no opinion", () => {
      expect(intersectSlashNames(ENTRIES, undefined)).toBe(ENTRIES);
    });

    it("keeps only the granted names, in catalog order", () => {
      expect(intersectSlashNames(ENTRIES, ["c", "a"])).toEqual([
        { name: "a" },
        { name: "c" },
      ]);
    });

    it("grants nothing for an empty role list", () => {
      // The Host never reaches here with an empty list unless the role really
      // grants nothing: it maps an empty `userSkills` onto `skills` first.
      expect(intersectSlashNames(ENTRIES, [])).toEqual([]);
    });
  });
});
