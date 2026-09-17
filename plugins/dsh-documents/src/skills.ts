/**
 * The skill surface (§20, §37, Phase 7).
 *
 * A comparison is only useful if the model reads it the way it was produced:
 * the change set is the fact, the interpretation is the model's, and no tool
 * call in the workflow needs a shell. `contract-review` states that contract
 * for the model, and this module vendors it inside the package so a workspace
 * with a restricted filesystem cannot hide it.
 *
 * The skill is mounted as a filesystem provider of its own, next to the
 * deployment's own skill roots, because the workflow it teaches is about one
 * feature: a deployment that turned comparison off has no use for it.
 */

import { fileURLToPath } from "node:url";

import type { Context } from "@deepseek-ai/cordis";
import * as skillFilesystem from "@deepseek-ai/dsh-skill-filesystem";

/**
 * Provider name on `ctx.skills`. Must not collide with DSH's own `filesystem`
 * provider or with another plugin's, and it is deliberately the plugin's own
 * name so a log line says who mounted it.
 */
export const DOCUMENT_SKILL_PROVIDER_NAME = "documents";

/** Skill root shipped in the package (`files: ["skills"]`). */
export const DOCUMENT_SKILLS_DIR = fileURLToPath(
  new URL("../skills", import.meta.url),
);

/** The one skill this plugin ships. */
export const CONTRACT_REVIEW_SKILL = "contract-review";

export function buildDocumentSkillsConfig(): {
  providerName: string;
  includeDefaultRoots: boolean;
  bundledSkillDir: string;
} {
  return {
    providerName: DOCUMENT_SKILL_PROVIDER_NAME,
    // The deployment's own project and user roots stay the business of the
    // provider DSH mounts; this one exists to publish the bundled skill.
    includeDefaultRoots: false,
    bundledSkillDir: DOCUMENT_SKILLS_DIR,
  };
}

export function mountDocumentSkills(ctx: Context): void {
  ctx.plugin(skillFilesystem, buildDocumentSkillsConfig());
}
