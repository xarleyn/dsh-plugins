import { normalizeWorkspacePath } from '../utils/paths.js';
import { hashFile } from '../utils/hashing.js';
import type { ChangeDetector, ChangeDiff, DetectorOptions, FileChange, FileSnapshot, TurnBaseline } from './types.js';
import {
  EMPTY_TREE,
  absoluteWorkspacePath,
  isGitWorktree,
  listGitFiles,
  nameStatusRange,
  resolveHead,
  statusEntries,
} from './git.js';
import { anySelectorMatches } from './snapshot.js';

type ChangeKind = 'added' | 'modified' | 'deleted';

interface GitState {
  head: string | undefined;
  /** Every dirty path (staged, worktree, untracked, deleted) with its snapshot. */
  files: Map<string, FileSnapshot>;
  degraded: boolean;
}

async function captureGitState(cwd: string, options: DetectorOptions): Promise<GitState> {
  const head = await resolveHead(cwd);
  const entries = await statusEntries(cwd);

  // Path → status entry; renames contribute both of their paths.
  const dirty = new Map<string, { untracked: boolean }>();
  for (const entry of entries) {
    const untracked = entry.x === '?' && entry.y === '?';
    for (const path of entry.paths) {
      dirty.set(path, { untracked });
    }
  }
  const ordered = [...dirty.entries()].sort(([left], [right]) => left.localeCompare(right));
  let degraded = false;
  if (ordered.length > options.maxFiles) {
    degraded = true;
    ordered.length = options.maxFiles;
  }

  const files = new Map<string, FileSnapshot>();
  for (const [path, entry] of dirty) {
    // Reading the path settles existence for free: deleted entries hash to
    // undefined and are recorded as absent, no status-letter parsing needed.
    const hash = await hashFile(absoluteWorkspacePath(cwd, path));
    files.set(
      path,
      hash === undefined
        ? { exists: false }
        : entry.untracked
          ? { exists: true, hash, untracked: true }
          : { exists: true, hash },
    );
  }

  return { head, files, degraded };
}

export function createGitDetector(options: DetectorOptions): ChangeDetector {
  return {
    kind: 'git',

    async captureBaseline(cwd: string): Promise<TurnBaseline> {
      const state = await captureGitState(cwd, options);
      return {
        cwd,
        kind: 'git',
        ...(state.head === undefined ? {} : { head: state.head }),
        files: state.files,
        createdAt: Date.now(),
        degraded: state.degraded,
      };
    },

    async computeChanges(cwd: string, baseline: TurnBaseline): Promise<ChangeDiff> {
      const current = await captureGitState(cwd, options);
      const rangeKinds = new Map<string, ChangeKind>();
      const currentHead = current.head;
      if (currentHead !== undefined) {
        const from = baseline.head ?? EMPTY_TREE;
        if (from !== currentHead) {
          try {
            for (const entry of await nameStatusRange(cwd, from, currentHead)) {
              const [toPath, fromPath] = entry.paths;
              if (entry.status === 'A') {
                if (toPath !== undefined) rangeKinds.set(toPath, 'added');
              } else if (entry.status === 'D') {
                if (toPath !== undefined) rangeKinds.set(toPath, 'deleted');
              } else if (entry.status === 'R' || entry.status === 'C') {
                if (toPath !== undefined) rangeKinds.set(toPath, 'added');
                if (fromPath !== undefined) rangeKinds.set(fromPath, 'deleted');
              } else if (toPath !== undefined) {
                rangeKinds.set(toPath, 'modified');
              }
            }
          } catch {
            // Unreadable commit range (shallow clone, rewritten history):
            // degrade to worktree-only detection instead of failing the stop.
          }
        }
      }

      const headsDiffer = (baseline.head ?? undefined) !== (current.head ?? undefined);
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
          headsDiffer,
        );
        if (kind !== undefined) changes.push({ path: normalizeWorkspacePath(rawPath), type: kind });
      }

      return { changes, degraded: baseline.degraded || current.degraded };
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
 * - dirty at baseline + clean now           → committed (range diff decides
 *   net change) or reverted (still a change when HEAD did not move).
 */
function classifyChange(
  before: FileSnapshot | undefined,
  after: FileSnapshot | undefined,
  rangeKind: ChangeKind | undefined,
  headsDiffer: boolean,
): ChangeKind | undefined {
  if (before === undefined && after === undefined) return rangeKind;
  if (before === undefined && after !== undefined) {
    // Absent from the baseline means clean-or-nonexistent at turn start:
    // an untracked path is brand new, a tracked path existed with HEAD content.
    if (after.untracked === true) return 'added';
    return after.exists ? 'modified' : 'deleted';
  }
  if (before !== undefined && after === undefined) {
    if (before.untracked === true) return 'deleted';
    if (!headsDiffer) return before.exists ? 'modified' : 'added';
    return rangeKind;
  }
  if (before !== undefined && after !== undefined) {
    if (before.exists && after.exists) {
      return before.hash !== after.hash ? 'modified' : undefined;
    }
    if (before.exists && !after.exists) return 'deleted';
    if (!before.exists && after.exists) return 'added';
  }
  return undefined;
}

export { isGitWorktree };
