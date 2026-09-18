import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaPersonalSkills } from "../src/personal-skills/index.js";
import {
  serviceFor,
  silentLogger,
  skillText,
  USER_A,
} from "./personal-skills.helpers.js";

describe("personal skill service", () => {
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
