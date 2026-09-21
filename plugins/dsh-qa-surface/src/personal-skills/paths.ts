import {
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  type Dirent,
} from "node:fs";
import path from "node:path";
import { canonicalCandidate, pathIsInside } from "../user-workspace.js";
import { QaPersonalSkillError } from "./errors.js";
import { skillNameProblem, skillRelativeRootSegments } from "./skill-format.js";

/**
 * Filesystem boundary of the personal-skills feature.
 *
 * Every path is derived, never accepted: the browser names a skill, the Host
 * combines the authenticated account's own workspace directory with the
 * configured relative root, and each step re-checks that the canonical result
 * still sits below that account's root. Symlinked directories are refused
 * rather than followed, so a link planted inside the personal root cannot
 * move reads or writes to another account's storage.
 *
 * `.dsh/skills-trash` is the removal destination: the last segment of the
 * configured relative root with a `-trash` suffix, so a deployment that moved
 * its skill directory keeps the trash beside it.
 */

export const QA_SKILL_TRASH_SUFFIX = "-trash";

export interface QaSkillRoots {
  /** The canonical account root every derived path must stay inside. */
  readonly personalRoot: string;
  /** The canonical directory holding one subdirectory per skill. */
  readonly skills: string;
  /** The canonical directory a removed skill directory is moved into. */
  readonly trash: string;
  /**
   * Whether these roots are the deployment-wide store rather than one
   * account's. The geometry is identical, so the flag travels with the roots
   * instead of being re-derived from them at every use.
   */
  readonly shared: boolean;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/**
 * Canonicalize a candidate below an already canonical parent. A path that
 * resolves elsewhere — a symlinked directory, a junction, a replaced ancestor
 * — is refused. `direct` additionally requires the result to be the parent's
 * own child, which is what pins each skill to one directory level.
 */
function canonicalInside(
  parent: string,
  relative: string,
  reason: "skill-name-invalid" | "storage-unavailable",
  message: string,
  direct: boolean,
): string {
  let canonical: string;
  try {
    canonical = canonicalCandidate(path.join(parent, relative));
  } catch (error) {
    throw new QaPersonalSkillError(
      "storage-unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (
    !pathIsInside(canonical, parent) ||
    (direct && !samePath(path.dirname(canonical), parent))
  ) {
    throw new QaPersonalSkillError(reason, message);
  }
  return canonical;
}

/** Derive and verify every directory the feature touches for one account. */
export function resolveSkillRoots(
  personalRoot: string,
  relativeRoot: string,
  /**
   * What the boundary refuses to leave, for the message an operator reads.
   * The same resolution serves an account directory and the deployment-wide
   * shared root, which have different owners but identical geometry.
   */
  boundary = "this account's",
): QaSkillRoots {
  const segments = [...skillRelativeRootSegments(relativeRoot)];
  const last = segments.pop();
  if (last === undefined) {
    throw new QaPersonalSkillError(
      "storage-unavailable",
      "the configured personal-skills root names no directory",
    );
  }
  const canonicalPersonal = canonicalCandidate(personalRoot);
  const skills = canonicalInside(
    canonicalPersonal,
    path.join(...segments, last),
    "storage-unavailable",
    `the configured skills root escapes ${boundary} directory`,
    false,
  );
  const trash = canonicalInside(
    canonicalPersonal,
    path.join(...segments, `${last}${QA_SKILL_TRASH_SUFFIX}`),
    "storage-unavailable",
    `the skills trash directory escapes ${boundary} directory`,
    false,
  );
  return { personalRoot: canonicalPersonal, skills, trash, shared: false };
}

/** The directory of one skill, validated against the scope's skills root. */
export function skillDirectory(
  roots: QaSkillRoots,
  name: string,
  boundary = "this account's",
): string {
  const problem = skillNameProblem(name);
  if (problem !== null) {
    throw new QaPersonalSkillError(
      "skill-name-invalid",
      `skill name is not usable: ${name}`,
    );
  }
  return canonicalInside(
    roots.skills,
    name,
    "skill-name-invalid",
    `the skill directory escapes ${boundary} skills root`,
    true,
  );
}

export function skillFilePath(roots: QaSkillRoots, name: string): string {
  return path.join(skillDirectory(roots, name), "SKILL.md");
}

/** Whether the directory exists at all, without following a symlink. */
export function directoryExists(input: string): boolean {
  try {
    const stat = lstatSync(input);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Refuse a symlinked or non-directory entry where a real directory belongs. */
function assertPlainDirectory(input: string): void {
  const stat = lstatSync(input);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new QaPersonalSkillError(
      "storage-unavailable",
      `personal skill storage must be a real directory: ${input}`,
    );
  }
}

/**
 * Materialize the skills root inside one account's personal root. Creation is
 * followed by a re-canonicalization, so a directory that appeared as a link
 * between the check and the `mkdir` is still refused.
 */
export function ensureSkillRoots(roots: QaSkillRoots): void {
  if (directoryExists(roots.skills)) {
    assertPlainDirectory(roots.skills);
    return;
  }
  try {
    const parent = path.dirname(roots.skills);
    if (directoryExists(parent)) assertPlainDirectory(parent);
    mkdirSync(roots.skills, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new QaPersonalSkillError(
      "storage-unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
  assertPlainDirectory(roots.skills);
  const verified = realpathSync.native(roots.skills);
  if (!pathIsInside(verified, roots.personalRoot)) {
    throw new QaPersonalSkillError(
      "storage-unavailable",
      "skill storage escapes the directory it was resolved against",
    );
  }
}

/** The skill subdirectories present for one account, sorted by name. */
export function listSkillDirectories(roots: QaSkillRoots): readonly string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(roots.skills, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new QaPersonalSkillError(
      "storage-unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}
