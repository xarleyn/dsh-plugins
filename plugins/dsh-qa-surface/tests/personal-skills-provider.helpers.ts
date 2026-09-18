import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@deepseek-ai/cordis";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { resolveConfig } from "../src/resolve-config.js";
import {
  createQaUserSkillProvider,
  QaPersonalSkills,
  type QaPersonalSkillContext,
} from "../src/personal-skills/index.js";

/**
 * The provider against the real DSH registry: the contract that matters is
 * not this plugin's idea of a skill but the one `ctx.skills` enforces, so
 * every expectation below goes through the shipped `SkillRegistry`.
 */

export const USER_A = "123e4567-e89b-42d3-a456-426614174000";
export const USER_B = "223e4567-e89b-42d3-a456-426614174001";

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  close() {},
} as never;

export interface Rig {
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

export async function rig(
  options: { readonly watch?: boolean } = {},
): Promise<Rig> {
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

export function writeSkill(
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
