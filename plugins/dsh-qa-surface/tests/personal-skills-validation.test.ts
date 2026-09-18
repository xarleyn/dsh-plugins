import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeAllowedTools,
  validateSkillDraft,
  QA_SKILL_FILE_MAX_BYTES,
  skillRelativeRootProblem,
  resolveSkillRoots,
  skillDirectory,
} from "../src/personal-skills/index.js";

describe("allowed-tools normalization", () => {
  it("reads the canonical scalar, an array and separators into one order", () => {
    const canonical = { tools: ["read", "grep"], rejected: [] };
    expect(normalizeAllowedTools("read grep")).toEqual(canonical);
    expect(normalizeAllowedTools(["read grep"])).toEqual(canonical);
    expect(normalizeAllowedTools(["grep", "read"])).toEqual({
      tools: ["grep", "read"],
      rejected: [],
    });
    expect(normalizeAllowedTools("read, grep")).toEqual(canonical);
    expect(normalizeAllowedTools("read  read   grep")).toEqual(canonical);
    expect(normalizeAllowedTools("")).toEqual({ tools: [], rejected: [] });
    expect(normalizeAllowedTools(undefined)).toEqual({
      tools: [],
      rejected: [],
    });
  });

  it("reports unusable entries instead of keeping or dropping them silently", () => {
    expect(normalizeAllowedTools("read ..\\escape a/b")).toEqual({
      tools: ["read"],
      rejected: ["..\\escape", "a/b"],
    });
    expect(normalizeAllowedTools(7)).toBeUndefined();
    expect(normalizeAllowedTools({ read: true })).toBeUndefined();
    expect(normalizeAllowedTools([1])).toBeUndefined();
  });
});

describe("skill draft validation", () => {
  const base = {
    name: "valid",
    description: "Valid.",
    whenToUse: null,
    modelInvocable: true,
    userInvocable: true,
    allowedTools: ["read"],
    sizeBytes: 100,
  };

  it("blocks an unusable name, a missing description and an oversized file", () => {
    const codes = validateSkillDraft({
      ...base,
      name: "Not Valid",
      description: "",
      sizeBytes: QA_SKILL_FILE_MAX_BYTES + 1,
    }).map((entry) => entry.code);
    expect(codes).toContain("name-invalid");
    expect(codes).toContain("description-required");
    expect(codes).toContain("file-too-large");
  });

  it("warns without blocking on soft limits and unavailable tools", () => {
    const diagnostics = validateSkillDraft({
      ...base,
      description: "d".repeat(2000),
      modelInvocable: false,
      userInvocable: false,
      allowedTools: ["read", "bash"],
      availableTools: ["read"],
      extraFieldNames: ["license", "x-vendor"],
    });
    expect(diagnostics.every((entry) => entry.severity === "warning")).toBe(
      true,
    );
    const codes = diagnostics.map((entry) => entry.code);
    expect(codes).toContain("description-too-long");
    expect(codes).toContain("invocation-never");
    expect(codes).toContain("tool-unavailable");
    expect(codes).toContain("unknown-field");
    // `license` is a recognized Agent Skills field, `x-vendor` is not.
    expect(
      diagnostics
        .filter((entry) => entry.code === "unknown-field")
        .map((entry) => entry.detail),
    ).toEqual(["x-vendor"]);
  });
});

describe("personal skill paths", () => {
  it("rejects a relative root that would move the storage boundary", () => {
    expect(skillRelativeRootProblem(".dsh/skills")).toBeNull();
    expect(skillRelativeRootProblem("skills")).toBeNull();
    expect(skillRelativeRootProblem("nested/skills")).toBeNull();
    expect(skillRelativeRootProblem("")).toMatch(/empty/u);
    expect(skillRelativeRootProblem("../escape")).toMatch(/\.\./u);
    expect(skillRelativeRootProblem("a/../../b")).toMatch(/\.\./u);
    expect(skillRelativeRootProblem("/absolute")).toMatch(/relative/u);
    expect(skillRelativeRootProblem("C:\\absolute")).toMatch(/relative/u);
    expect(skillRelativeRootProblem(".\\x")).toBeNull();
  });

  it("refuses a traversal or separator in the skill name", () => {
    const personal = mkdtempSync(path.join(tmpdir(), "qa-skill-paths-"));
    const roots = resolveSkillRoots(personal, ".dsh/skills");
    for (const name of ["../escape", "..", "a/b", "a\\b", "", ".hidden"]) {
      expect(() => skillDirectory(roots, name)).toThrow(/not usable|escapes/u);
    }
    expect(skillDirectory(roots, "ok-name")).toBe(
      path.join(personal, ".dsh", "skills", "ok-name"),
    );
    expect(roots.trash).toBe(path.join(personal, ".dsh", "skills-trash"));
  });
});
