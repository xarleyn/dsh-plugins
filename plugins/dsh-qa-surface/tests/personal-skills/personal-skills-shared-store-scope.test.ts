import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareQaUserWorkspace } from "../../src/user-workspace.js";
import { serviceFor, skillText, USER_A } from "./personal-skills.helpers.js";

/** Write one valid skill directory, as a hand edit or another deployment would. */
function writeSkill(root: string, name: string): void {
  const directory = path.join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "SKILL.md"),
    skillText([`name: ${name}`, "description: Stand instruction."]),
    "utf8",
  );
}

/**
 * Which store the console's shared tab opens.
 *
 * The shared scope is the QA store beside the registered workspace
 * (`<workspace>/.dsh/skills`), read by every QA session as `qa-shared`. It is
 * deliberately not the host's own skill catalog — the `skill-filesystem`
 * presets read their own `customSkillDirs`, which the console lists read-only
 * on its «Навыки» table. The two are separate stores, so an empty shared tab is
 * an empty QA store rather than a missing deployment catalog; these tests pin
 * that separation, because the acceptance round read the empty tab as "the
 * stand has no skills".
 */
describe("shared skill store scope", () => {
  it("resolves the shared scope to the QA store, not to a host catalog directory", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-shared-"));
    const { service, context } = serviceFor({ workspace });
    const sharedRoot = service.rootPath({ shared: true });
    expect(sharedRoot).toBe(path.join(workspace, ".dsh", "skills"));
    // The store is materialized by the first read, so the console can name the
    // directory an administrator is about to write into.
    expect(existsSync(sharedRoot)).toBe(true);

    // A host-shaped catalog — a `skills` directory of the deployment, or a
    // `customSkillDirs` entry — is never what this scope resolves to: the host
    // catalog is read from outside the QA workspace and stays read-only.
    writeSkill(path.join(workspace, "skills"), "host-copy");
    writeSkill(path.join(workspace, "custom-skills"), "preset-copy");
    expect(service.list({ shared: true })).toEqual([]);
    expect(service.list(context)).toEqual([]);

    writeSkill(sharedRoot, "qa-shared-notes");
    expect(service.list({ shared: true }).map(({ name }) => name)).toEqual([
      "qa-shared-notes",
    ]);
    // Neither host-shaped directory leaks into the account's own store.
    expect(service.list(context)).toEqual([]);
  });

  it("reports an empty shared store as empty instead of refusing it", () => {
    const workspace = mkdtempSync(
      path.join(tmpdir(), "qa-skills-shared-empty-"),
    );
    const { service } = serviceFor({ workspace });
    // The console renders this list as its empty state; a deployment that has
    // never written a QA skill must read as "nothing here yet", not as a
    // storage failure, and the path it names must stay the QA one.
    expect(service.list({ shared: true })).toEqual([]);
    expect(service.rootPath({ shared: true })).toBe(
      path.join(workspace, ".dsh", "skills"),
    );
  });

  it("offers a shared skill to every account and excludes host catalogs", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-shared-see-"));
    const { service } = serviceFor({ workspace });
    writeSkill(path.join(workspace, "skills"), "host-copy");
    writeSkill(path.join(workspace, ".dsh", "skills"), "qa-shared-notes");

    const cwd = prepareQaUserWorkspace(workspace, USER_A);
    const discovered = service.discover(cwd);
    // The account's own root comes first and is empty; the deployment's QA
    // store follows and is labelled as shared, which is why the console calls
    // it a store of its own rather than one account's catalog.
    expect(
      discovered.map(({ directoryName, shared }) => ({
        directoryName,
        shared,
      })),
    ).toEqual([{ directoryName: "qa-shared-notes", shared: true }]);
  });
});
