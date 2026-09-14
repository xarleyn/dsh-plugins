import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@deepseek-ai/cordis";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import {
  createQaUserSkillProvider,
  QaPersonalSkills,
  QaPersonalSkillsHost,
  QaSkillWatcher,
  QA_USER_SKILLS_PROVIDER,
  type QaPersonalSkillContext,
} from "../src/personal-skills/index.js";

/**
 * The provider against the real DSH registry: the contract that matters is
 * not this plugin's idea of a skill but the one `ctx.skills` enforces, so
 * every expectation below goes through the shipped `SkillRegistry`.
 */

const USER_A = "123e4567-e89b-42d3-a456-426614174000";
const USER_B = "223e4567-e89b-42d3-a456-426614174001";

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  close() {},
} as never;

interface Rig {
  readonly workspace: string;
  readonly rootA: string;
  readonly rootB: string;
  readonly ctx: Context;
  readonly service: QaPersonalSkills;
  readonly context: QaPersonalSkillContext;
  /** How many times a write asked the registry to refresh. */
  readonly invalidated: () => number;
  /** Invalidate directly, standing in for the manual-edit watcher. */
  readonly refresh: () => void;
}

async function rig(options: { readonly watch?: boolean } = {}): Promise<Rig> {
  const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-provider-"));
  const config = resolveConfig({
    session: { workspaceId: "workspace-1" },
    accounts: {
      enabled: true,
      perUserWorkspace: true,
      skills: { watch: options.watch ?? false },
    },
    lockdown: {
      sandboxMode: "workspace-write",
      permissionPreset: "qa-workspace-write",
      toolPolicy: { allow: ["read", "grep"] },
    },
    sources: { enabled: false },
  });
  // The registry's own invalidation callback: `registerProvider` returns a
  // disposer, not this, and the provider factory runs synchronously.
  let invalidateCatalog: () => void = () => undefined;
  let invalidated = 0;
  const context = {
    tools: {
      schemas: () => [
        { name: "read", description: "Read a file", parameters: {} },
        { name: "write", description: "Write a file", parameters: {} },
      ],
    },
  };
  const service = new QaPersonalSkills(context as never, {
    getConfig: () => config,
    logger: silentLogger,
    workspacePath: () => workspace,
    invalidate: () => {
      invalidated += 1;
      invalidateCatalog();
    },
  });
  const ctx = new Context();
  await ctx.plugin(SkillRegistry);
  ctx.skills.registerProvider((control) => {
    invalidateCatalog = control.invalidate;
    return createQaUserSkillProvider(control, service);
  });
  return {
    workspace,
    rootA: path.join(workspace, ".qa-users", USER_A),
    rootB: path.join(workspace, ".qa-users", USER_B),
    ctx,
    service,
    context: { userId: USER_A },
    invalidated: () => invalidated,
    refresh: () => invalidateCatalog(),
  };
}

function writeSkill(
  rigged: Rig,
  name: string,
  frontmatter: readonly string[],
  body = "Steps.",
): string {
  const directory = path.join(rigged.rootA, ".dsh", "skills", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\n${frontmatter.join("\n")}\n---\n\n${body}\n`,
  );
  return directory;
}

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

describe("personal skills host", () => {
  it("registers one provider and detaches it on dispose", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-host-"));
    const config = resolveConfig({
      session: { workspaceId: "workspace-1" },
      accounts: { enabled: true, perUserWorkspace: true },
      lockdown: {
        sandboxMode: "workspace-write",
        permissionPreset: "qa-workspace-write",
        toolPolicy: { allow: ["read"] },
      },
      sources: { enabled: false },
    });
    const ctx = new Context();
    await ctx.plugin(SkillRegistry);
    Object.assign(ctx, {
      tools: { schemas: () => [] },
      workspaceRegistry: { get: () => ({ path: workspace }) },
    });
    const host = new QaPersonalSkillsHost({
      ctx,
      getConfig: () => config,
      logger: silentLogger,
    });
    // `ctx.inject` runs the registration callback on the next microtask when
    // the service is already mounted.
    await Promise.resolve();
    await Promise.resolve();
    expect(host.registered).toBe(true);

    const root = path.join(workspace, ".qa-users", USER_A);
    mkdirSync(path.join(root, ".dsh", "skills", "hosted"), { recursive: true });
    writeFileSync(
      path.join(root, ".dsh", "skills", "hosted", "SKILL.md"),
      "---\nname: hosted\ndescription: Registered through the host.\n---\n\nBody.\n",
    );
    expect(
      (await ctx.skills.list({ cwd: root })).map((entry) => entry.name),
    ).toEqual(["hosted"]);

    host.dispose();
    expect(host.registered).toBe(false);
    expect(await ctx.skills.list({ cwd: root })).toEqual([]);
  });
});

describe("manual-edit watcher", () => {
  it("follows a root once, coalesces events and bounds its registrations", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-skills-watch-"));
    const other = mkdtempSync(path.join(tmpdir(), "qa-skills-watch-b-"));
    const third = mkdtempSync(path.join(tmpdir(), "qa-skills-watch-c-"));
    let changes = 0;
    const watcher = new QaSkillWatcher({
      onChange: () => {
        changes += 1;
      },
      onError: () => undefined,
      debounceMs: 20,
      limit: 2,
    });
    watcher.follow(root);
    watcher.follow(root);
    expect(watcher.size).toBe(1);
    watcher.follow(other);
    watcher.follow(third);
    // The bound evicts the least recently added root rather than growing.
    expect(watcher.size).toBe(2);

    writeFileSync(
      path.join(other, "SKILL.md"),
      `---
name: watched
description: Watched.
---
`,
    );
    const deadline = Date.now() + 5_000;
    while (changes === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(changes).toBeGreaterThan(0);

    watcher.dispose();
    expect(watcher.size).toBe(0);
  });
});
