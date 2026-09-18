import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createQaUserSkillProvider,
  QA_USER_SKILLS_PROVIDER,
} from "../src/personal-skills/index.js";
import { rig, writeSkill } from "./personal-skills-provider.helpers.js";

describe("qa-user-skills provider against the DSH registry", () => {
  it("publishes one account's skills and nobody else's", async () => {
    const rigged = await rig();
    writeSkill(
      rigged,
      "api-testing",
      [
        "name: api-testing",
        "description: Test REST and GraphQL APIs.",
        "allowed-tools: read write",
      ],
      "1. Read the endpoint.",
    );
    // A skill in a plain directory of the same workspace is not a QA skill.
    const stray = path.join(rigged.workspace, "skills", "stray");
    mkdirSync(stray, { recursive: true });
    writeFileSync(
      path.join(stray, "SKILL.md"),
      "---\nname: stray\ndescription: Outside the account layout.\n---\n\nBody.\n",
    );

    const mine = await rigged.ctx.skills.list({ cwd: rigged.rootA });
    expect(mine.map((entry) => entry.name)).toEqual(["api-testing"]);
    expect(mine[0]).toMatchObject({
      description: "Test REST and GraphQL APIs.",
      provider: QA_USER_SKILLS_PROVIDER,
      source: "qa-user",
      invocation: { modelInvocable: true, userInvocable: true },
      resourceBase: {
        kind: "directory",
        path: path.join(rigged.rootA, ".dsh", "skills", "api-testing"),
      },
    });

    // Another account's scope, and a cwd that is not an account directory at
    // all, both see nothing.
    expect(await rigged.ctx.skills.list({ cwd: rigged.rootB })).toEqual([]);
    expect(await rigged.ctx.skills.list({ cwd: rigged.workspace })).toEqual([]);
    expect(await rigged.ctx.skills.list()).toEqual([]);

    const loaded = await rigged.ctx.skills.get("api-testing", {
      cwd: rigged.rootA,
    });
    expect(loaded?.content).toBe("1. Read the endpoint.");
    expect(loaded?.path).toBe(
      path.join(rigged.rootA, ".dsh", "skills", "api-testing", "SKILL.md"),
    );
    // The declared tool list rides the candidate metadata; nothing in the
    // harness enforces it, and this provider does not pretend otherwise.
    expect(loaded?.metadata).toEqual({ allowedTools: ["read", "write"] });
    expect(
      await rigged.ctx.skills.get("api-testing", { cwd: rigged.rootB }),
    ).toBeUndefined();
  });

  it("honours the invocation flags the file declares", async () => {
    const rigged = await rig();
    writeSkill(rigged, "manual-only", [
      "name: manual-only",
      "description: A human invokes this one.",
      "disable-model-invocation: true",
    ]);
    writeSkill(rigged, "model-only", [
      "name: model-only",
      "description: Only the model picks this up.",
      "user-invocable: false",
    ]);
    const listed = await rigged.ctx.skills.list({ cwd: rigged.rootA });
    const byName = new Map(listed.map((entry) => [entry.name, entry]));
    expect(byName.get("manual-only")?.invocation).toEqual({
      modelInvocable: false,
      userInvocable: true,
    });
    expect(byName.get("model-only")?.invocation).toEqual({
      modelInvocable: true,
      userInvocable: false,
    });
  });

  it("sees a saved skill at once, and a hand edit once something invalidates", async () => {
    const rigged = await rig();
    expect(await rigged.ctx.skills.list({ cwd: rigged.rootA })).toEqual([]);
    rigged.service.create(rigged.context, {
      name: "fresh",
      description: "Created through the editor.",
      whenToUse: "When fresh.",
      modelInvocable: true,
      userInvocable: true,
      allowedTools: ["read"],
      body: "Body after create.",
      expectedRevision: null,
    });
    // The write invalidated the registry's catalog cache.
    expect(rigged.invalidated()).toBe(1);
    const afterCreate = await rigged.ctx.skills.list({ cwd: rigged.rootA });
    expect(afterCreate.map((entry) => entry.name)).toEqual(["fresh"]);
    expect(afterCreate[0]?.whenToUse).toBe("When fresh.");

    const file = path.join(rigged.rootA, ".dsh", "skills", "fresh", "SKILL.md");
    writeFileSync(
      file,
      `---
name: fresh
description: Edited by hand.
---

Hand body.
`,
    );
    // A full definition is never cached, so a hand edit is already visible to
    // whoever loads the body...
    expect(
      (await rigged.ctx.skills.get("fresh", { cwd: rigged.rootA }))?.content,
    ).toBe("Hand body.");
    // ...while the catalog summary is the registry's cache, which is exactly
    // why a manual edit needs an invalidation (the watcher's job).
    expect(
      (await rigged.ctx.skills.list({ cwd: rigged.rootA }))[0]?.description,
    ).toBe("Created through the editor.");
    rigged.refresh();
    expect(
      (await rigged.ctx.skills.list({ cwd: rigged.rootA }))[0]?.description,
    ).toBe("Edited by hand.");

    // Removal publishes too, so the next catalog read no longer offers it.
    const document = rigged.service.get(rigged.context, "fresh");
    rigged.service.remove(rigged.context, "fresh", document.revision);
    expect(rigged.invalidated()).toBe(2);
    expect(await rigged.ctx.skills.list({ cwd: rigged.rootA })).toEqual([]);
  });

  it("skips a file DSH could not accept as a skill", async () => {
    const rigged = await rig();
    writeSkill(rigged, "good", ["name: good", "description: Fine."]);
    // A name that disagrees with its directory, and a file with no frontmatter
    // at all: both stay visible in the editor and out of the model catalog.
    writeSkill(rigged, "mismatched", ["name: other", "description: Mismatch."]);
    const broken = path.join(rigged.rootA, ".dsh", "skills", "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(path.join(broken, "SKILL.md"), "No frontmatter at all.\n");

    const listed = await rigged.ctx.skills.list({ cwd: rigged.rootA });
    expect(listed.map((entry) => entry.name)).toEqual(["good"]);
    const editor = rigged.service.list(rigged.context);
    expect(editor.map((entry) => entry.name)).toEqual([
      "broken",
      "good",
      "mismatched",
    ]);
    expect(editor.find((entry) => entry.name === "broken")?.valid).toBe(false);
    expect(
      editor
        .find((entry) => entry.name === "mismatched")
        ?.diagnostics.map((entry) => entry.code),
    ).toContain("name-mismatch");
  });

  it("ignores an abort and a candidate it did not produce", async () => {
    const rigged = await rig();
    writeSkill(rigged, "listed", ["name: listed", "description: Listed."]);
    const listed = await rigged.ctx.skills.list({ cwd: rigged.rootA });
    expect(listed).toHaveLength(1);
    const foreign = {
      ...listed[0],
      name: "foreign",
      locator: undefined,
    } as never;
    const provider = createQaUserSkillProvider(
      { signal: new AbortController().signal, invalidate: () => undefined },
      rigged.service,
    );
    expect(await provider.get(foreign, { cwd: rigged.rootA })).toBeUndefined();
    const aborted = createQaUserSkillProvider(
      {
        signal: AbortSignal.abort(),
        invalidate: () => undefined,
      },
      rigged.service,
    );
    expect(await aborted.list({ cwd: rigged.rootA })).toEqual([]);
  });
});
