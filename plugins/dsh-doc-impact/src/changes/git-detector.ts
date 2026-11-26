import { normalizeWorkspacePath } from "../utils/paths.js";
import { hashFile } from "../utils/hashing.js";
import type {
  ChangeDetector,
  ChangeDiff,
  DetectorOptions,
  FileChange,
  FileSnapshot,
  TurnBaseline,
} from "./types.js";
import {
  EMPTY_TREE,
  absoluteWorkspacePath,
  isGitWorktree,
  listGitFiles,
  nameStatusRange,
  resolveHead,
  statusEntries,
} from "./git.js";
import { anySelectorMatches } from "./snapshot.js";

type ChangeKind = "added" | "modified" | "deleted";

interface GitState {
  head: string | undefined;
  /** Every dirty path (staged, worktree, untracked, deleted) with its snapshot. */
  files: Map<string, FileSnapshot>;
  degraded: boolean;
}

async function captureGitState(
  cwd: string,
  options: DetectorOptions,
  baseline?: TurnBaseline,
): Promise<GitState> {
  const head = await resolveHead(cwd);
  const entries = await statusEntries(cwd);

  // Path → status entry; renames contribute both of their paths.
  // A formerly dirty file can be clean now because its contents were
  // committed. Compare the bytes at both ends of the turn, even then.
  const dirty = new Map<string, "untracked" | "added" | undefined>();
  for (const path of baseline?.files.keys() ?? []) dirty.set(path, undefined);
  for (const entry of entries) {
    const untracked = entry.x === "?" && entry.y === "?";
    const added = [entry.x, entry.y].some((status) => "ARC".includes(status));
    for (const [index, path] of entry.paths.entries()) {
      if (index > 0 && (entry.x === "C" || entry.y === "C")) continue;
      dirty.set(
        path,
        untracked ? "untracked" : index === 0 && added ? "added" : undefined,
      );
    }
  }
  const ordered = [...dirty.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  let degraded = false;
  if (ordered.length > options.maxFiles) {
    degraded = true;
    ordered.length = options.maxFiles;
  }

  // The bounded set is what gets read: hashing every dirty path first would
  // turn `maxFiles` into a report-only cap instead of an I/O budget.
  const files = new Map<string, FileSnapshot>();
  for (const [path, addition] of ordered) {
    // Reading the path settles existence for free: deleted entries hash to
    // undefined and are recorded as absent, no status-letter parsing needed.
    const hash = await hashFile(absoluteWorkspacePath(cwd, path));
    files.set(path, {
      exists: hash !== undefined,
      ...(hash === undefined ? {} : { hash }),
      ...(addition === undefined ? {} : { [addition]: true }),
    });
  }

  return { head, files, degraded };
}

export function createGitDetector(options: DetectorOptions): ChangeDetector {
  return {
    kind: "git",

    async captureBaseline(cwd: string): Promise<TurnBaseline> {
      const state = await captureGitState(cwd, options);
      return {
        cwd,
        kind: "git",
        ...(state.head === undefined ? {} : { head: state.head }),
        files: state.files,
        createdAt: Date.now(),
        degraded: state.degraded,
      };
    },

    async computeChanges(
      cwd: string,
      baseline: TurnBaseline,
    ): Promise<ChangeDiff> {
      const current = await captureGitState(cwd, options, baseline);
      const rangeKinds = new Map<string, ChangeKind>();
      const currentHead = current.head;
      let degraded = baseline.degraded || current.degraded;
      if (currentHead !== undefined) {
        const from = baseline.head ?? EMPTY_TREE;
        if (from !== currentHead) {
          try {
            for (const entry of await nameStatusRange(cwd, from, currentHead)) {
              const [toPath, fromPath] = entry.paths;
              if (entry.status === "A") {
                if (toPath !== undefined) rangeKinds.set(toPath, "added");
              } else if (entry.status === "D") {
                if (toPath !== undefined) rangeKinds.set(toPath, "deleted");
              } else if (entry.status === "R" || entry.status === "C") {
                if (toPath !== undefined) rangeKinds.set(toPath, "added");
                if (entry.status === "R" && fromPath !== undefined)
                  rangeKinds.set(fromPath, "deleted");
              } else if (toPath !== undefined) {
                rangeKinds.set(toPath, "modified");
              }
            }
          } catch {
            // Unreadable commit range (shallow clone, rewritten history):
            // degrade to worktree-only detection instead of failing the stop.
            degraded = true;
          }
        }
      }

      const paths = new Set<string>([
        ...baseline.files.keys(),
        ...current.files.keys(),
        ...rangeKinds.keys(),
      ]);

      const changes: FileChange[] = [];
      for (const rawPath of paths) {
        const kind = classifyChange(
          baseline.files.get(rawPath),
          current.files.get(rawPath),
          rangeKinds.get(rawPath),
        );
        if (kind !== undefined)
          changes.push({ path: normalizeWorkspacePath(rawPath), type: kind });
      }

      return { changes, degraded };
    },

    async listFiles(cwd: string): Promise<string[]> {
      const all = await listGitFiles(cwd);
      return all.filter((path) => anySelectorMatches(path, options.selectors));
    },
  };
}

/**
 * Dirty-workspace attribution (SPEC §19-§21):
 * - clean at baseline + dirty now           → the agent changed it;
 * - dirty at baseline + different hash now  → the agent changed it further;
 * - same hash                               → pre-existing user change, skip;
 * - a path already dirty at baseline is read again inside the same bounded
 *   set even if a commit or revert made its git status clean.
 */
function classifyChange(
  before: FileSnapshot | undefined,
  after: FileSnapshot | undefined,
  rangeKind: ChangeKind | undefined,
): ChangeKind | undefined {
  if (before === undefined && after === undefined) return rangeKind;
  if (before === undefined && after !== undefined) {
    // Absent from the baseline means clean-or-nonexistent at turn start:
    // an untracked path is brand new, a tracked path existed with HEAD content.
    if (after.untracked || after.added || rangeKind === "added")
      return after.exists ? "added" : undefined;
    return after.exists ? "modified" : "deleted";
  }
  if (before !== undefined && after !== undefined) {
    if (before.exists && after.exists) {
      return before.hash !== after.hash ? "modified" : undefined;
    }
    if (before.exists && !after.exists) return "deleted";
    if (!before.exists && after.exists) return "added";
  }
  return undefined;
}

export { isGitWorktree };
