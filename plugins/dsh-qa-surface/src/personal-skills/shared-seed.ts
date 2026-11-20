import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { ResolvedQaSurfaceConfig } from "../types.js";
import { skillDirectory, type QaSkillRoots } from "./paths.js";
import { parseSkillFile } from "./skill-file.js";
import { validateSkillDraft } from "./skill-format.js";

function validateSeed(directory: string, maxBytes: number): void {
  const file = path.join(directory, "SKILL.md");
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > maxBytes)
    throw new Error(
      "shared skill requires a regular SKILL.md within the configured size limit",
    );
  const parsed = parseSkillFile(readFileSync(file, "utf8"));
  if (!parsed.ok) throw new Error(`invalid shared SKILL.md: ${parsed.code}`);
  const problem = validateSkillDraft(parsed.value).find(
    (entry) => entry.severity === "error",
  );
  if (problem) throw new Error(`invalid shared SKILL.md: ${problem.code}`);
}

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
  maxBytes: number,
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
      // Inspect the named entry itself. The canonical path can resolve a link
      // to another skill in this same store.
      const entry = lstatSync(path.join(roots.skills, name), {
        throwIfNoEntry: false,
      });
      if (entry !== undefined && !entry.isDirectory()) {
        throw new Error("shared seed target must be a real directory");
      }
      if (entry === undefined) {
        const source = path.join(seed.root, name);
        if (!lstatSync(source).isDirectory()) {
          throw new Error("seed must be a real skill directory");
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
        validateSeed(staging, maxBytes);
        renameSync(staging, target);
        staging = undefined;
        changed = true;
        logger.info("skill.shared-seeded", { name });
      } else {
        validateSeed(target, maxBytes);
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
