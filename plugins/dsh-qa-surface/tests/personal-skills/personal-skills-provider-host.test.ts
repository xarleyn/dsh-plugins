import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@deepseek-ai/cordis";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { prepareQaUserWorkspace } from "../../src/user-workspace.js";
import { QaPersonalSkillsHost } from "../../src/personal-skills/index.js";
import { silentLogger, USER_A } from "./personal-skills-provider.helpers.js";

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

  it("creates the account's skills root instead of failing to watch it", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-host-root-"));
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
    const warnings: unknown[] = [];
    const logger = {
      debug() {},
      info() {},
      error() {},
      close() {},
      warn(event: string, payload: unknown) {
        warnings.push({ event, payload });
      },
    } as never;
    const ctx = new Context();
    await ctx.plugin(SkillRegistry);
    Object.assign(ctx, {
      tools: { schemas: () => [] },
      workspaceRegistry: { get: () => ({ path: workspace }) },
    });
    const host = new QaPersonalSkillsHost({
      ctx,
      getConfig: () => config,
      logger,
    });
    await Promise.resolve();
    await Promise.resolve();

    // A session opens in an account directory provisioned without a skill
    // tree inside it. Discovery must leave one behind: that directory is the
    // root the watcher follows, and a missing one used to be reported as a
    // failed watch on every boot of every account.
    const root = prepareQaUserWorkspace(workspace, USER_A);
    expect(existsSync(path.join(root, ".dsh", "skills"))).toBe(false);
    expect(await ctx.skills.list({ cwd: root })).toEqual([]);
    expect(existsSync(path.join(root, ".dsh", "skills"))).toBe(true);
    expect(warnings).toEqual([]);

    host.dispose();
  });
});
