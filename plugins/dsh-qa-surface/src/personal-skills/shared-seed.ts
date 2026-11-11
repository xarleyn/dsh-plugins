import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { ResolvedQaSurfaceConfig } from "../types.js";
import { skillDirectory, type QaSkillRoots } from "./paths.js";

/**
 * Promote an operator-selected subset of a read-only catalog into the shared
 * store. Copy complete directories, including resources, before publishing a
 * skill. Neither a restart, an updated seed nor an editor deletion restores
 * the original bytes: a hidden per-name receipt survives rename and removal.
 * Existing shared directories always belong to the operator and win as-is.
 */
export function seedSharedSkills(
  roots: QaSkillRoots,
  seed: ResolvedQaSurfaceConfig["accounts"]["skills"]["sharedSeed"],
  logger: PluginLogger,
): boolean {
  if (seed === null) return false;
  let changed = false;
  for (const name of seed.names) {
    const receipt = path.join(roots.skills, `.seeded-${name}`);
    if (existsSync(receipt)) continue;
    let staging: string | undefined;
    try {
      const target = skillDirectory(roots, name);
      if (!existsSync(target)) {
        const source = path.join(seed.root, name);
        if (
          !lstatSync(source).isDirectory() ||
          lstatSync(source).isSymbolicLink()
        ) {
          throw new Error("seed must be a real skill directory");
        }
        if (!lstatSync(path.join(source, "SKILL.md")).isFile()) {
          throw new Error("seed has no SKILL.md file");
        }
        staging = mkdtempSync(path.join(roots.skills, ".seed-"));
        cpSync(source, staging, {
          recursive: true,
          filter: (entry) => {
            const stat = lstatSync(entry);
            if (
              stat.isSymbolicLink() ||
              (!stat.isDirectory() && !stat.isFile())
            ) {
              throw new Error(
                "seed resources must be ordinary files and directories",
              );
            }
            return true;
          },
        });
        renameSync(staging, target);
        staging = undefined;
        changed = true;
        logger.info("skill.shared-seeded", { name });
      }
      writeFileSync(receipt, "1\n", { flag: "wx", mode: 0o600 });
    } catch (error) {
      // A missing optional seed must not hide other shared skills or mark the
      // whole DSH snapshot incomplete. No receipt means a later read retries.
      logger.warn("skill.shared-seed-failed", {
        name,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (staging !== undefined)
        rmSync(staging, { recursive: true, force: true });
    }
  }
  return changed;
}
