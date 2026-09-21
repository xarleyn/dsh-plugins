import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareQaUserWorkspace } from "../src/user-workspace.js";
import {
  serviceFor,
  skillText,
  USER_A,
  USER_B,
} from "./personal-skills.helpers.js";

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

  it("materializes the account's skill root before anything is saved", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-root-"));
    const { service, observed, context } = serviceFor({ workspace });
    const skillsRoot = path.join(
      workspace,
      ".qa-users",
      USER_A,
      ".dsh",
      "skills",
    );
    expect(existsSync(skillsRoot)).toBe(false);

    // The editor's first read meets an account directory that exists and owns
    // no skills yet: it must leave the tree behind, because the session that
    // discovers the same account follows exactly that root.
    expect(service.list(context)).toEqual([]);
    expect(existsSync(skillsRoot)).toBe(true);

    // The session path provisions the account directory and discovers its
    // skills in one go — the root is reported only once it is there.
    const cwd = prepareQaUserWorkspace(workspace, USER_B);
    expect(service.discover(cwd)).toEqual([]);
    expect(existsSync(path.join(cwd, ".dsh", "skills"))).toBe(true);
    // Two roots, in the order the read reports them: the account's own, then
    // the deployment's shared one beside the registered workspace. Both are
    // reported so a manual edit in either is what invalidates the catalog.
    expect(observed()).toEqual([
      path.join(cwd, ".dsh", "skills"),
      path.join(workspace, ".dsh", "skills"),
    ]);
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
});
