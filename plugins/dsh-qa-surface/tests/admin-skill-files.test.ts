import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QA_SKILL_ADMIN_EDITS_FILE } from "../src/personal-skills/index.js";
import { prepareQaUserWorkspace } from "../src/user-workspace.js";
import { harness, refusal } from "./admin-service.helpers.js";

function draft(overrides: Record<string, unknown> = {}) {
  return {
    name: "release-notes",
    description: "Пишет заметки о релизе",
    whenToUse: null,
    modelInvocable: true,
    userInvocable: true,
    allowedTools: ["read"],
    body: "# Release notes\n\n1. Собери изменения.\n",
    expectedRevision: null,
    ...overrides,
  };
}

/**
 * What an administrator's own edit leaves behind: the file, the audit row and
 * the mark the owner reads. The tests take the admin token and the owner's
 * token from the same deployment, because the claim under test is precisely
 * that the two see different things about one file.
 */
describe("admin skill files", () => {
  it("refuses every skill call to a role without skills.manage", async () => {
    const { service, alice, bob } = harness();
    const user = { kind: "user", userId: alice.user.id } as const;
    // A plain account is not a curator of anything, its own skills included:
    // its own editor is the personal-skills surface, not the console.
    expect(
      await refusal(() => service.skills(alice.token, user)),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() => service.skill(alice.token, user, "release-notes")),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() => service.saveSkill(alice.token, user, null, draft())),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() =>
        service.removeSkill(alice.token, user, "release-notes", null),
      ),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() =>
        service.validateSkill(alice.token, user, null, draft()),
      ),
    ).toMatchObject({ reason: "forbidden" });
    expect(
      await refusal(() => service.skillTools(bob.token, user)),
    ).toMatchObject({ reason: "forbidden" });
  });

  it("edits the deployment's shared store, which every account reads", async () => {
    const { service, skills, workspace, admin } = harness();
    const scope = { kind: "shared" } as const;
    const before = await service.skills(admin.token, scope);
    expect(before.skills).toEqual([]);
    expect(before.owner).toBeNull();
    expect(before.rootPath).toBe(path.join(workspace, ".dsh", "skills"));

    const saved = await service.saveSkill(admin.token, scope, null, draft());
    expect(saved.name).toBe("release-notes");
    expect(saved.adminEdit?.actorId).toBe(admin.user.id);
    expect(
      existsSync(path.join(before.rootPath, "release-notes", "SKILL.md")),
    ).toBe(true);

    // A session's own discovery sees it, labelled as the deployment's: this is
    // what makes a shared skill worth writing.
    const cwd = prepareQaUserWorkspace(workspace, admin.user.id);
    const found = skills.discover(cwd).find(({ directoryName }) => {
      return directoryName === "release-notes";
    });
    expect(found?.shared).toBe(true);
    expect(found?.contents?.description).toBe("Пишет заметки о релизе");
  });

  it("marks the owner's skill as an administrator's write and audits it", async () => {
    const { service, skills, quality, admin, alice } = harness();
    const scope = { kind: "user", userId: alice.user.id } as const;
    const view = await service.skills(admin.token, scope);
    expect(view.owner).toMatchObject({ userId: alice.user.id });
    expect(view.skills).toEqual([]);

    await service.saveSkill(admin.token, scope, null, {
      ...draft(),
      name: "from-admin",
    });
    const created = await service.skill(admin.token, scope, "from-admin");
    expect(created.adminEdit).toMatchObject({ actorId: admin.user.id });

    // The owner reads the same file through their own service and sees the
    // mark — the whole point of writing it.
    const owned = skills
      .list({ userId: alice.user.id })
      .find(({ name }) => name === "from-admin");
    expect(owned?.adminEdit?.actorId).toBe(admin.user.id);

    const events = quality.auditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: admin.user.id,
      action: "skill.created",
      targetType: "skill",
      targetId: "from-admin",
    });
    expect(events[0]?.before).toBeUndefined();
    expect(JSON.parse(String(events[0]?.after))).toMatchObject({
      scope: "user",
      ownerId: alice.user.id,
      name: "from-admin",
    });
  });

  it("clears the mark once the owner writes the skill themselves", async () => {
    const { service, skills, admin, alice } = harness();
    const scope = { kind: "user", userId: alice.user.id } as const;
    const written = await service.saveSkill(admin.token, scope, null, draft());
    expect(written.adminEdit).not.toBeNull();

    skills.update({ userId: alice.user.id }, written.name, {
      ...draft(),
      description: "Пишет заметки о релизе по-своему",
      expectedRevision: written.revision,
    });
    const owned = skills
      .list({ userId: alice.user.id })
      .find(({ name }) => name === written.name);
    // The badge answers "did an administrator write what I am looking at",
    // not "was this file ever touched": the bytes are the owner's again.
    expect(owned?.adminEdit).toBeNull();
  });

  it("refuses a stale revision and writes no audit row for it", async () => {
    const { service, quality, admin, alice } = harness();
    const scope = { kind: "user", userId: alice.user.id } as const;
    await service.saveSkill(admin.token, scope, null, draft());
    // The same name again, echoing the revision the first save produced: the
    // second save is what an editor sends after reading the file.
    const before = await service.skill(admin.token, scope, "release-notes");
    await expect(
      service.saveSkill(admin.token, scope, "release-notes", {
        ...draft({ body: "# второй\n" }),
        expectedRevision: before.revision,
      }),
    ).resolves.toMatchObject({ name: "release-notes" });
    const afterUpdate = quality.auditEvents().length;
    await expect(
      service.saveSkill(admin.token, scope, "release-notes", {
        ...draft(),
        expectedRevision: before.revision,
      }),
    ).rejects.toMatchObject({ reason: "skill-conflict" });
    // A refused save writes nothing, the audit trail included: a row for a
    // write that never happened would be a lie about the store.
    expect(quality.auditEvents()).toHaveLength(afterUpdate);
    expect(
      (await service.skill(admin.token, scope, "release-notes")).body,
    ).toContain("второй");
  });

  it("removes a skill into its own trash and records the deletion", async () => {
    const { service, quality, admin, alice } = harness();
    const scope = { kind: "user", userId: alice.user.id } as const;
    const written = await service.saveSkill(admin.token, scope, null, draft());
    const removal = await service.removeSkill(
      admin.token,
      scope,
      written.name,
      written.revision,
    );
    expect(removal).toEqual({ name: "release-notes", trashed: true });
    const events = quality.auditEvents();
    expect(events.map(({ action }) => action)).toEqual([
      "skill.created",
      "skill.deleted",
    ]);
    expect(JSON.parse(String(events[1]?.before))).toMatchObject({
      name: "release-notes",
      revision: written.revision,
    });
    // Gone from the catalog, kept in the trash beside the account's root.
    expect(await service.skills(admin.token, scope)).toMatchObject({
      skills: [],
    });
  });

  it("refuses a scope naming an account that does not exist", async () => {
    const { service, admin } = harness();
    const scope = {
      kind: "user",
      userId: "323e4567-e89b-42d3-a456-426614174002",
    } as const;
    expect(
      await refusal(() => service.skills(admin.token, scope)),
    ).toMatchObject({ reason: "invalid-credentials" });
  });

  it("checks an unsaved draft against the scope it would be saved into", async () => {
    const { service, admin } = harness();
    const scope = { kind: "shared" } as const;
    const validation = await service.validateSkill(
      admin.token,
      scope,
      null,
      draft({ name: "Not Kebab" }),
    );
    expect(validation.preview).toContain("name: Not Kebab");
    expect(validation.diagnostics.map(({ code }) => code)).toContain(
      "name-invalid",
    );
    const tools = await service.skillTools(admin.token, scope);
    expect(tools.map(({ name }) => name)).toContain("read");
  });

  it("keeps the mark file beside the skills it describes, not among them", async () => {
    const { service, admin, alice } = harness();
    const scope = { kind: "user", userId: alice.user.id } as const;
    await service.saveSkill(admin.token, scope, null, draft());
    const root = (await service.skills(admin.token, scope)).rootPath;
    const entries = readdirSync(root).sort();
    // The sidecar is a dot entry: nothing that enumerates skills can mistake
    // it for one, and the editor's own catalog shows only the skill.
    expect(entries).toEqual([QA_SKILL_ADMIN_EDITS_FILE, "release-notes"]);
    expect(
      (await service.skills(admin.token, scope)).skills.map(({ name }) => name),
    ).toEqual(["release-notes"]);
  });
});
