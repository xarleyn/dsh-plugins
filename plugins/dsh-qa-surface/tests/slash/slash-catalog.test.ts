import { describe, expect, it } from "vitest";
import {
  buildSlashCatalog,
  slashEntryId,
  type BuildSlashCatalogOptions,
} from "../../src/slash/catalog.js";

const ALL = { mode: "all" as const, allow: [] };
const NONE = { mode: "deny-all" as const, allow: [] };

function build(
  overrides: Partial<BuildSlashCatalogOptions> = {},
): ReturnType<typeof buildSlashCatalog> {
  return buildSlashCatalog({
    skills: [],
    commands: [],
    skillPolicy: ALL,
    commandPolicy: NONE,
    commandSurface: "ready",
    ...overrides,
  });
}

describe("unified slash catalog", () => {
  it("keeps a skill and a command of the same name apart", () => {
    const entries = build({
      skills: [{ name: "plan", description: "Skill plan" }],
      commands: [{ name: "plan", description: "Command plan" }],
      commandPolicy: ALL,
    });
    expect(entries.map((entry) => entry.id)).toEqual([
      "skill:plan",
      "command:plan",
    ]);
    expect(entries[0]?.description).toBe("Skill plan");
    expect(entries[1]?.description).toBe("Command plan");
  });

  it("builds identity from the kind, never from the bare name", () => {
    expect(slashEntryId("skill", "plan")).toBe("skill:plan");
    expect(slashEntryId("command", "plan")).toBe("command:plan");
  });

  it("leads with skills and keeps both halves alphabetical", () => {
    const entries = build({
      skills: [
        { name: "zeta", description: "" },
        { name: "alpha", description: "" },
      ],
      commands: [
        { name: "yank", description: "" },
        { name: "bravo", description: "" },
      ],
      commandPolicy: ALL,
    });
    expect(entries.map((entry) => entry.name)).toEqual([
      "alpha",
      "zeta",
      "bravo",
      "yank",
    ]);
  });

  it("applies each policy to its own half", () => {
    const entries = build({
      skills: [{ name: "a", description: "" }],
      commands: [{ name: "b", description: "" }],
      skillPolicy: NONE,
      commandPolicy: ALL,
    });
    expect(entries.map((entry) => entry.id)).toEqual(["command:b"]);
  });

  it("offers no command when the native surface is not ready", () => {
    const entries = build({
      commands: [{ name: "compact", description: "" }],
      commandPolicy: ALL,
      commandSurface: "inactive",
    });
    expect(entries).toEqual([]);
  });

  it("carries the command capability flags the palette needs", () => {
    const entries = build({
      commands: [
        {
          name: "goal",
          description: "",
          inputHint: "[<objective>|clear]",
          acceptsAttachments: true,
        },
        { name: "compact", description: "" },
      ],
      commandPolicy: ALL,
    });
    const compact = entries.find((entry) => entry.id === "command:compact");
    const goal = entries.find((entry) => entry.id === "command:goal");
    expect(Object.hasOwn(compact ?? {}, "acceptsAttachments")).toBe(false);
    expect(Object.hasOwn(compact ?? {}, "inputHint")).toBe(false);
    expect(goal).toMatchObject({
      inputHint: "[<objective>|clear]",
      acceptsAttachments: true,
    });
  });

  it("marks a skill the model may not invoke", () => {
    const entries = build({
      skills: [
        { name: "user-only", description: "", modelInvocable: false },
        { name: "shared", description: "", modelInvocable: true },
      ],
    });
    expect(entries.find((entry) => entry.name === "user-only")).toMatchObject({
      kind: "skill",
      modelInvocable: false,
    });
    expect(entries.find((entry) => entry.name === "shared")).toMatchObject({
      kind: "skill",
      modelInvocable: true,
    });
  });

  it("hides the skills a role withholds", () => {
    const entries = build({
      skills: [
        { name: "a", description: "" },
        { name: "b", description: "" },
      ],
      grantedSkills: ["b"],
    });
    expect(entries.map((entry) => entry.name)).toEqual(["b"]);
  });

  it("never emits two rows with the same identity", () => {
    const entries = build({
      skills: [
        { name: "a", description: "first" },
        { name: "a", description: "second" },
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.description).toBe("first");
  });

  it("omits the optional fields a skill does not declare", () => {
    const entries = build({
      skills: [{ name: "a", description: "" }],
    });
    // Absent, not present-and-undefined: the wire is JSON, and the palette
    // distinguishes "no hint" from "an empty hint".
    expect(Object.hasOwn(entries[0] ?? {}, "whenToUse")).toBe(false);
    expect(Object.hasOwn(entries[0] ?? {}, "modelInvocable")).toBe(false);
    expect(entries[0]?.description).toBe("");
  });
});
