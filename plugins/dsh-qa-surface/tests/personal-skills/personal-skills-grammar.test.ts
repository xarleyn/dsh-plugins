import { describe, expect, it } from "vitest";
import {
  parseSkillFile,
  serializeSkillFile,
  skillNameProblem,
  toJsonValue,
} from "../../src/personal-skills/index.js";
import { skillText } from "./personal-skills.helpers.js";

describe("skill name grammar", () => {
  it("accepts kebab-case and rejects everything DSH would refuse", () => {
    expect(skillNameProblem("jira-investigation")).toBeNull();
    expect(skillNameProblem("a")).toBeNull();
    expect(skillNameProblem("api2-test")).toBeNull();
    expect(skillNameProblem("")).toBe("name-required");
    expect(skillNameProblem("Jira")).toBe("name-invalid");
    expect(skillNameProblem("-lead")).toBe("name-invalid");
    expect(skillNameProblem("trail-")).toBe("name-invalid");
    expect(skillNameProblem("two--dashes")).toBe("name-invalid");
    expect(skillNameProblem("with space")).toBe("name-invalid");
    expect(skillNameProblem("dot.name")).toBe("name-invalid");
    expect(skillNameProblem("sla/sh")).toBe("name-invalid");
    expect(skillNameProblem("a".repeat(65))).toBe("name-invalid");
  });
});

describe("skill frontmatter", () => {
  it("parses the canonical file the serializer writes", () => {
    const text = serializeSkillFile({
      name: "jira-investigation",
      description: "Analyse Jira issues and the related source.",
      whenToUse: "When the user asks to investigate a Jira issue.",
      modelInvocable: true,
      userInvocable: true,
      allowedTools: ["jira_search", "read", "grep"],
      extraFrontmatter: {},
      body: "# Jira\n\n1. Read the issue.",
    });
    const parsed = parseSkillFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.name).toBe("jira-investigation");
    expect(parsed.value.description).toBe(
      "Analyse Jira issues and the related source.",
    );
    expect(parsed.value.whenToUse).toBe(
      "When the user asks to investigate a Jira issue.",
    );
    expect(parsed.value.allowedTools).toEqual(["jira_search", "read", "grep"]);
    expect(parsed.value.body).toBe("# Jira\n\n1. Read the issue.");
    expect(parsed.value.modelInvocable).toBe(true);
    expect(parsed.value.userInvocable).toBe(true);
  });

  it("keeps YAML-significant text intact across a round trip", () => {
    const draft = {
      name: "quoting",
      description: 'Colon: inside, "quotes", emoji 🚀 and a # hash',
      whenToUse: "Line one\nLine two",
      modelInvocable: true,
      userInvocable: true,
      allowedTools: ["read"],
      extraFrontmatter: {},
      body: "Body with --- inside\n\nand a trailing colon:",
    };
    const parsed = parseSkillFile(serializeSkillFile(draft));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.description).toBe(draft.description);
    expect(parsed.value.whenToUse).toBe(draft.whenToUse);
    expect(parsed.value.body).toBe(draft.body);
  });

  it("preserves foreign frontmatter fields and their values", () => {
    const text = skillText([
      "name: imported",
      "description: Imported from elsewhere.",
      "license: MIT",
      "compatibility: dsh>=0.1.5",
      "metadata:",
      "  owner: alice",
      "  pinned: true",
      "x-vendor-field: 42",
      "user-invocable: false",
    ]);
    const parsed = parseSkillFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.userInvocable).toBe(false);
    expect(parsed.value.extraFrontmatter).toEqual({
      license: "MIT",
      compatibility: "dsh>=0.1.5",
      metadata: { owner: "alice", pinned: true },
      "x-vendor-field": 42,
    });
    // A known field is never duplicated into the preserved set.
    expect(Object.keys(parsed.value.extraFrontmatter)).not.toContain(
      "user-invocable",
    );
    const rewritten = serializeSkillFile({
      ...parsed.value,
      description: "Edited description.",
    });
    expect(rewritten).toContain("license: MIT");
    expect(rewritten).toContain("owner: alice");
    expect(rewritten).toContain("x-vendor-field: 42");
    expect(rewritten).toContain("description: Edited description.");
    expect(parseSkillFile(rewritten)).toMatchObject({ ok: true });
  });

  it("omits whenToUse when it is empty", () => {
    const text = serializeSkillFile({
      name: "no-when",
      description: "No routing hint.",
      whenToUse: "   ",
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      extraFrontmatter: {},
      body: "",
    });
    expect(text).not.toContain("whenToUse");
    expect(text).not.toContain("allowed-tools");
    const parsed = parseSkillFile(text);
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) expect(parsed.value.whenToUse).toBeNull();
  });

  it("maps the invocation flags onto the shipped frontmatter keys", () => {
    const text = serializeSkillFile({
      name: "manual-only",
      description: "Only a human may invoke this.",
      whenToUse: null,
      modelInvocable: false,
      userInvocable: true,
      allowedTools: [],
      extraFrontmatter: {},
      body: "Steps.",
    });
    expect(text).toContain("disable-model-invocation: true");
    expect(text).toContain("user-invocable: true");
    const parsed = parseSkillFile(text);
    if (parsed.ok) {
      expect(parsed.value.modelInvocable).toBe(false);
      expect(parsed.value.userInvocable).toBe(true);
    }
  });

  it("accepts the boolean spellings upstream accepts", () => {
    for (const [spelling, modelInvocable] of [
      ["true", false],
      ["yes", false],
      ["on", false],
      ["1", false],
      ["false", true],
      ["no", true],
      ["0", true],
    ] as const) {
      const parsed = parseSkillFile(
        skillText([
          "name: spelling",
          "description: Boolean spelling.",
          `disable-model-invocation: ${spelling}`,
        ]),
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value.modelInvocable).toBe(modelInvocable);
    }
  });

  it("reports why a file cannot become a skill", () => {
    expect(parseSkillFile("no frontmatter here")).toMatchObject({
      ok: false,
      code: "frontmatter-missing",
    });
    expect(parseSkillFile("---\nname: a\n# never closed\n")).toMatchObject({
      ok: false,
      code: "frontmatter-invalid",
    });
    expect(parseSkillFile("---\n: : :\n---\nbody")).toMatchObject({
      ok: false,
      code: "frontmatter-invalid",
    });
    expect(parseSkillFile("---\n- a\n- b\n---\nbody")).toMatchObject({
      ok: false,
      code: "frontmatter-invalid",
    });
    expect(parseSkillFile(skillText(["description: No name."]))).toMatchObject({
      ok: false,
      code: "name-required",
    });
    expect(
      parseSkillFile(skillText(["name: Bad Name", "description: x"])),
    ).toMatchObject({ ok: false, code: "name-invalid" });
    expect(parseSkillFile(skillText(["name: no-description"]))).toMatchObject({
      ok: false,
      code: "description-required",
    });
    expect(
      parseSkillFile(
        skillText([
          "name: legacy",
          "description: Legacy key.",
          "disableModelInvocation: true",
        ]),
      ),
    ).toMatchObject({ ok: false, code: "invocation-legacy-key" });
    expect(
      parseSkillFile(
        skillText([
          "name: bad-boolean",
          "description: Bad boolean.",
          "user-invocable: maybe",
        ]),
      ),
    ).toMatchObject({ ok: false, code: "invocation-invalid" });
    expect(
      parseSkillFile(
        skillText([
          "name: bad-tools",
          "description: Bad tools.",
          "allowed-tools:",
          "  read: true",
        ]),
      ),
    ).toMatchObject({ ok: false, code: "allowed-tools-invalid" });
  });

  it("drops a frontmatter value the JSON bridge cannot carry, with a warning", () => {
    // `!!binary` parses to a Buffer: neither JSON nor safe to flatten into its
    // own enumerable keys, so the value is reported and left out.
    const parsed = parseSkillFile(
      skillText([
        "name: binary-field",
        "description: Tagged value.",
        "x-blob: !!binary aGk=",
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.extraFrontmatter["x-blob"]).toBeUndefined();
    expect(
      parsed.value.warnings.filter(
        (entry) => entry.code === "field-type-invalid",
      ),
    ).toEqual([
      {
        code: "field-type-invalid",
        severity: "warning",
        field: null,
        detail: "x-blob",
      },
    ]);
  });

  it("keeps JSON-representable values of every shape", () => {
    expect(toJsonValue({ a: [1, "two", true, null], b: { c: 3 } })).toEqual({
      a: [1, "two", true, null],
      b: { c: 3 },
    });
    expect(toJsonValue(new Date())).toBeUndefined();
    expect(toJsonValue(Buffer.from("hi"))).toBeUndefined();
    expect(toJsonValue(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(toJsonValue(undefined)).toBeUndefined();
  });
});
