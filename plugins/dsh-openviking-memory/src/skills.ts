/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 *
 * Skill surface: mounts the filesystem skill provider over the vendored
 * `openviking-memory` skill, so the model can learn how to use OpenViking
 * whether or not automatic context injection is enabled.
 */

import { fileURLToPath } from "node:url";

import type { Context } from "@deepseek-ai/cordis";
import * as skillFilesystem from "@deepseek-ai/dsh-skill-filesystem";

/** Provider name on `ctx.skills`; must not collide with DSH's own `filesystem`. */
export const SKILL_PROVIDER_NAME = "openviking";

/** The shared `openviking-memory` skill, vendored from upstream `examples/skills`. */
export const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));

export function buildSkillsConfig(): {
  providerName: string;
  includeDefaultRoots: boolean;
  bundledSkillDir: string;
} {
  return {
    providerName: SKILL_PROVIDER_NAME,
    includeDefaultRoots: false,
    bundledSkillDir: SKILLS_DIR,
  };
}

export function mountOpenVikingSkills(ctx: Context): void {
  ctx.plugin(skillFilesystem, buildSkillsConfig());
}
