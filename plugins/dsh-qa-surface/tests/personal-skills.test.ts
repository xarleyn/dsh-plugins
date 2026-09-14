import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import {
  createQaPersonalSkillRemotes,
  normalizeAllowedTools,
  parseSkillFile,
  QaPersonalSkills,
  serializeSkillFile,
  skillNameProblem,
  skillRelativeRootProblem,
  resolveSkillRoots,
  skillDirectory,
  toJsonValue,
  validateSkillDraft,
  QA_SKILL_FILE_MAX_BYTES,
  type QaPersonalSkillContext,
} from "../src/personal-skills/index.js";

const USER_A = "123e4567-e89b-42d3-a456-426614174000";
const USER_B = "223e4567-e89b-42d3-a456-426614174001";

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  close() {},
} as never;

function skillText(
  lines: readonly string[],
  body = "# Heading\n\n1. Step.",
): string {
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

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

function serviceFor(options: {
  readonly workspace: string;
  readonly tools?: readonly string[];
  readonly allow?: readonly string[];
  readonly userId?: string;
  readonly maxSkillBytes?: number;
  readonly relativeRoot?: string;
}): {
  readonly service: QaPersonalSkills;
  readonly invalidations: () => number;
  readonly context: QaPersonalSkillContext;
} {
  const config = resolveConfig({
    session: { workspaceId: "workspace-1" },
    accounts: {
      enabled: true,
      perUserWorkspace: true,
      skills: {
        ...(options.relativeRoot === undefined
          ? {}
          : { relativeRoot: options.relativeRoot }),
        ...(options.maxSkillBytes === undefined
          ? {}
          : { maxSkillBytes: options.maxSkillBytes }),
      },
    },
    lockdown: {
      sandboxMode: "workspace-write",
      permissionPreset: "qa-workspace-write",
      toolPolicy: { allow: [...(options.allow ?? ["read", "grep"])] },
    },
    sources: { enabled: false },
  });
  let invalidations = 0;
  const context = {
    tools: {
      schemas: () =>
        (options.tools ?? ["read", "grep", "write"]).map((name) => ({
          name,
          description: `${name} tool`,
          parameters: {},
        })),
    },
  };
  return {
    service: new QaPersonalSkills(context as never, {
      getConfig: () => config,
      logger: silentLogger,
      workspacePath: () => options.workspace,
      invalidate: () => {
        invalidations += 1;
      },
    }),
    invalidations: () => invalidations,
    context: { userId: options.userId ?? USER_A },
  };
}

describe("personal skill service", () => {
  it("creates a portable SKILL.md below the account's own workspace", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-service-"));
    const { service, invalidations, context } = serviceFor({ workspace });
    const created = service.create(context, {
      name: "api-testing",
      description: "Test REST and GraphQL APIs.",
      whenToUse: "When the user asks to test an API.",
      modelInvocable: true,
      userInvocable: true,
      allowedTools: ["read", "grep", "jira_transition"],
      body: "1. Read the endpoint.\n2. Send a request.",
      expectedRevision: null,
    });
    expect(created.name).toBe("api-testing");
    expect(created.unavailableTools).toEqual(["jira_transition"]);
    expect(created.sourcePath).toBe(
      path.join(
        workspace,
        ".qa-users",
        USER_A,
        ".dsh",
        "skills",
        "api-testing",
        "SKILL.md",
      ),
    );
    expect(invalidations()).toBe(1);
    const listed = service.list(context);
    expect(listed.map((entry) => entry.name)).toEqual(["api-testing"]);
    expect(listed[0]?.valid).toBe(true);
    expect(service.get(context, "api-testing").body).toContain(
      "Send a request",
    );
  });

  it("refuses a duplicate name and keeps a bad draft off the disk", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-dup-"));
    const { service, context } = serviceFor({ workspace });
    const input = {
      name: "dup",
      description: "First.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      body: "",
      expectedRevision: null,
    };
    service.create(context, input);
    expect(() => service.create(context, input)).toThrow(/already exists/u);
    expect(() =>
      service.create(context, {
        ...input,
        name: "../escape",
        description: "x",
      }),
    ).toThrow(/name/u);
    expect(service.list(context)).toHaveLength(1);
  });

  it("refuses a stale revision and reports a manual edit", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-conflict-"));
    const { service, context } = serviceFor({ workspace });
    const created = service.create(context, {
      name: "conflict",
      description: "Original.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      body: "Original body.",
      expectedRevision: null,
    });
    const file = created.sourcePath;
    expect(() =>
      service.update(context, "conflict", {
        name: "conflict",
        description: "Stale write.",
        whenToUse: null,
        modelInvocable: true,
        userInvocable: true,
        allowedTools: [],
        body: "Stale.",
        expectedRevision: "0000",
      }),
    ).toThrow(/changed after it was read/u);

    // A hand edit outside the editor is visible immediately, and the editor's
    // own revision no longer matches.
    writeFileSync(
      file,
      skillText(
        ["name: conflict", "description: Edited by hand."],
        "Hand-written body.",
      ),
    );
    const afterHandEdit = service.get(context, "conflict");
    expect(afterHandEdit.description).toBe("Edited by hand.");
    expect(afterHandEdit.revision).not.toBe(created.revision);
    expect(() =>
      service.update(context, "conflict", {
        name: "conflict",
        description: "Editor write.",
        whenToUse: null,
        modelInvocable: true,
        userInvocable: true,
        allowedTools: [],
        body: "Editor body.",
        expectedRevision: created.revision,
      }),
    ).toThrow(/changed after it was read/u);

    const saved = service.update(context, "conflict", {
      name: "conflict",
      description: "Editor write.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      body: "Editor body.",
      expectedRevision: afterHandEdit.revision,
    });
    expect(saved.description).toBe("Editor write.");
    expect(saved.body).toBe("Editor body.");
  });

  it("renames the directory, keeping resources and foreign frontmatter", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-rename-"));
    const { service, context } = serviceFor({ workspace });
    const created = service.create(context, {
      name: "before",
      description: "Renamed later.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      body: "Body.",
      expectedRevision: null,
    });
    // A resource the v1 editor does not manage must survive every write.
    const skillDir = path.dirname(created.sourcePath);
    writeFileSync(
      created.sourcePath,
      skillText([
        "name: before",
        "description: Renamed later.",
        "license: MIT",
      ]),
    );
    writeFileSync(path.join(skillDir, "notes.md"), "reference\n");
    const before = service.get(context, "before");
    const renamed = service.update(context, "before", {
      name: "after",
      description: "Renamed.",
      whenToUse: "When renamed.",
      modelInvocable: false,
      userInvocable: true,
      allowedTools: ["read"],
      body: before.body,
      expectedRevision: before.revision,
    });
    expect(renamed.name).toBe("after");
    expect(renamed.extraFrontmatter).toEqual({ license: "MIT" });
    expect(renamed.resourceCount).toBe(1);
    expect(service.list(context).map((entry) => entry.name)).toEqual(["after"]);
    expect(
      path.join(path.dirname(path.dirname(renamed.sourcePath)), "notes.md"),
    ).not.toBe(renamed.sourcePath);
  });

  it("moves a removed skill into the trash beside its root", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-trash-"));
    const { service, context } = serviceFor({ workspace });
    service.create(context, {
      name: "disposable",
      description: "Removed.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      body: "",
      expectedRevision: null,
    });
    const removal = service.remove(context, "disposable", null);
    expect(removal).toEqual({ name: "disposable", trashed: true });
    expect(service.list(context)).toHaveLength(0);
    expect(() => service.get(context, "disposable")).toThrow(/no skill/u);
    expect(() => service.remove(context, "disposable", null)).toThrow(
      /no skill/u,
    );
  });

  it("isolates two accounts sharing one workspace", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-isolation-"));
    const alice = serviceFor({ workspace, userId: USER_A });
    const bob = serviceFor({ workspace, userId: USER_B });
    alice.service.create(alice.context, {
      name: "alice-only",
      description: "Alice's skill.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      body: "Secret.",
      expectedRevision: null,
    });
    expect(alice.service.list(alice.context)).toHaveLength(1);
    expect(bob.service.list(bob.context)).toHaveLength(0);
    expect(() => bob.service.get(bob.context, "alice-only")).toThrow(
      /no skill/u,
    );
    expect(() =>
      bob.service.update(bob.context, "alice-only", {
        name: "alice-only",
        description: "Hijacked.",
        whenToUse: null,
        modelInvocable: true,
        userInvocable: true,
        allowedTools: [],
        body: "",
        expectedRevision: null,
      }),
    ).toThrow(/no skill/u);
    // Discovery is keyed by the session cwd, so a foreign cwd reads nothing.
    const aliceSkills = alice.service.discover(
      path.join(workspace, ".qa-users", USER_A),
    );
    const bobSkills = bob.service.discover(
      path.join(workspace, ".qa-users", USER_B),
    );
    expect(aliceSkills.map((entry) => entry.directoryName)).toEqual([
      "alice-only",
    ]);
    expect(bobSkills).toHaveLength(0);
    // A cwd outside the account layout exposes nothing at all.
    expect(alice.service.discover(workspace)).toHaveLength(0);
    expect(
      alice.service.discover(path.join(workspace, "elsewhere")),
    ).toHaveLength(0);
  });

  it("reports an oversized file and a name that disagrees with its directory", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-limits-"));
    const { service, context } = serviceFor({ workspace });
    service.create(context, {
      name: "oversized",
      description: "Too big.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      body: "x",
      expectedRevision: null,
    });
    const oversized = service.get(context, "oversized");
    writeFileSync(
      oversized.sourcePath,
      skillText(
        ["name: oversized", "description: Too big."],
        "y".repeat(64 * 1024),
      ),
    );
    const listed = service
      .list(context)
      .find((entry) => entry.name === "oversized");
    expect(listed?.valid).toBe(true);

    // The operator's ceiling is what the limit compares against.
    const small = serviceFor({ workspace, maxSkillBytes: 4096 });
    const limited = small.service
      .list(small.context)
      .find((entry) => entry.name === "oversized");
    expect(limited?.valid).toBe(false);
    expect(limited?.diagnostics.map((entry) => entry.code)).toContain(
      "file-too-large",
    );

    service.create(context, {
      name: "declared-other",
      description: "Frontmatter names another skill.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      body: "",
      expectedRevision: null,
    });
    const file = service.get(context, "declared-other").sourcePath;
    writeFileSync(
      file,
      skillText(["name: elsewhere", "description: Mismatched."], "Body."),
    );
    const mismatched = service
      .list(context)
      .find((entry) => entry.name === "declared-other");
    expect(mismatched?.diagnostics.map((entry) => entry.code)).toContain(
      "name-mismatch",
    );
    // Discovery drops it: DSH cannot address a skill whose file disagrees.
    expect(
      service
        .discover(path.join(workspace, ".qa-users", USER_A))
        .map((entry) => entry.directoryName),
    ).not.toContain("declared-other");
  });

  it("reports a missing SKILL.md as a repairable document", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-missing-"));
    const { service, context } = serviceFor({ workspace });
    const created = service.create(context, {
      name: "half-made",
      description: "Placeholder.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      body: "",
      expectedRevision: null,
    });
    // The editor still opens a skill whose file was deleted underneath it.
    rmSync(created.sourcePath);
    const document = service.get(context, "half-made");
    expect(document.valid).toBe(false);
    expect(document.diagnostics.map((entry) => entry.code)).toEqual([
      "skill-file-missing",
    ]);
    expect(document.sourcePath).toBe(created.sourcePath);
  });

  it("marks only the QA scope's own tools as available", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-tools-"));
    const { service, context } = serviceFor({
      workspace,
      tools: ["read", "grep", "write", "jira_search"],
      allow: ["read", "grep"],
    });
    service.create(context, {
      name: "tool-user",
      description: "Declares tools.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: ["read", "write", "jira_transition"],
      body: "",
      expectedRevision: null,
    });
    const catalog = service.tools(context);
    const byName = new Map(catalog.map((entry) => [entry.name, entry]));
    expect(byName.get("read")).toMatchObject({
      available: true,
      description: "read tool",
    });
    expect(byName.get("grep")).toMatchObject({ available: true });
    expect(byName.get("write")).toMatchObject({
      available: false,
      description: "write tool",
    });
    // A tool no registry ever had stays offerable-but-unavailable, so an
    // imported skill can always be repaired.
    expect(byName.get("jira_transition")).toMatchObject({ available: false });
    expect(byName.get("jira_search")).toMatchObject({ available: false });
    const names = catalog.map((entry) => entry.name);
    expect(names.indexOf("read")).toBeLessThan(names.indexOf("write"));
  });

  it("checks a draft without writing, with the stored frontmatter and limit", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-validate-"));
    const { service, context } = serviceFor({ workspace, maxSkillBytes: 4096 });
    expect(service.list(context)).toHaveLength(0);
    // A check creates nothing: the account directory stays empty.
    const preview = service.validate(context, null, {
      name: "checked-only",
      description: "Checked but never saved.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: ["read"],
      body: "Body.",
      expectedRevision: null,
    });
    expect(preview.preview).toContain("name: checked-only");
    expect(preview.preview).toContain("allowed-tools: read");
    expect(preview.preview).toContain("Body.");
    expect(service.list(context)).toHaveLength(0);

    // An edited skill keeps the fields the editor does not own, exactly as a
    // save would, and the operator's own ceiling is what the size rule uses.
    service.create(context, {
      name: "existing",
      description: "Existing.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      body: "Body.",
      expectedRevision: null,
    });
    const file = service.get(context, "existing").sourcePath;
    writeFileSync(
      file,
      skillText(["name: existing", "description: Existing.", "license: MIT"]),
    );
    const checked = service.validate(context, "existing", {
      name: "existing",
      description: "Renamed description.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: [],
      body: "y".repeat(5000),
      expectedRevision: null,
    });
    expect(checked.preview).toContain("license: MIT");
    expect(checked.diagnostics.map((entry) => entry.code)).toContain(
      "file-too-large",
    );
    expect(checked.preview).toContain("description: Renamed description.");

    // The draft's own problems come back as diagnostics, not as an exception.
    const invalid = service.validate(context, null, {
      name: "Not Valid",
      description: "",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: ["read ..\escape"],
      body: "",
      expectedRevision: null,
    });
    expect(invalid.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "name-invalid",
        "description-required",
        "tool-name-invalid",
      ]),
    );
  });

  it("refuses an invalid relative root at configuration time", () => {
    expect(() =>
      resolveConfig({
        accounts: {
          enabled: true,
          perUserWorkspace: true,
          skills: { relativeRoot: "../escape" },
        },
        session: { workspaceId: "workspace-1" },
        lockdown: { sandboxMode: "workspace-write" },
      }),
    ).toThrow(/accounts\.skills\.relativeRoot/u);
  });

  it("turns itself off where no per-account directory exists", () => {
    const off = resolveConfig({ accounts: { enabled: false } });
    expect(off.accounts.skills.enabled).toBe(false);
    const shared = resolveConfig({ accounts: { enabled: true } });
    expect(shared.accounts.skills.enabled).toBe(false);
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-off-"));
    const disabled = new QaPersonalSkills({} as never, {
      getConfig: () => off,
      logger: silentLogger,
      workspacePath: () => workspace,
      invalidate: () => undefined,
    });
    expect(disabled.enabled).toBe(false);
    expect(() => disabled.list({ userId: USER_A })).toThrow(/not enabled/u);
    expect(disabled.discover(workspace)).toEqual([]);
  });
});

describe("personal skill remotes", () => {
  function remotesFor(
    workspace: string,
    accounts: {
      readonly user?: string;
    } = {},
  ): ReturnType<typeof createQaPersonalSkillRemotes> {
    const { service } = serviceFor({ workspace });
    const store = {
      requireUser: () => ({ id: accounts.user ?? USER_A }),
    };
    const config = resolveConfig({
      session: { workspaceId: "workspace-1" },
      accounts: { enabled: true, perUserWorkspace: true },
      lockdown: { sandboxMode: "workspace-write" },
      sources: { enabled: false },
    });
    return createQaPersonalSkillRemotes({
      getConfig: () => config,
      logger: silentLogger,
      skills: service,
      accounts: {
        resolve: () => store as never,
        run: (operation: () => unknown) => operation(),
      } as never,
    });
  }

  it("carries a refusal on the shared reason marker", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-remotes-"));
    const remotes = remotesFor(workspace);
    expect(remotes.list("token").skills).toEqual([]);
    const created = remotes.create("token", {
      name: "remote-made",
      description: "Made over the wire.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: ["read"],
      body: "Body.",
      expectedRevision: null,
    });
    expect(created.name).toBe("remote-made");
    expect(remotes.get("token", "remote-made").preview).toContain(
      "description: Made over the wire.",
    );
    expect(() => remotes.get("token", "nope")).toThrow(
      /reason: skill-not-found/u,
    );
    expect(() =>
      remotes.update("token", "remote-made", {
        name: "remote-made",
        description: "Stale.",
        whenToUse: null,
        modelInvocable: true,
        userInvocable: true,
        allowedTools: [],
        body: "",
        expectedRevision: "stale",
      }),
    ).toThrow(/reason: skill-conflict/u);
    expect(() =>
      remotes.create("token", {
        name: "Bad Name",
        description: "Invalid.",
        whenToUse: null,
        modelInvocable: true,
        userInvocable: true,
        allowedTools: [],
        body: "",
        expectedRevision: null,
      }),
    ).toThrow(/reason: skill-name-invalid/u);
    expect(remotes.remove("token", "remote-made", null).trashed).toBe(true);
  });
});
