import { glob } from 'tinyglobby';
import { isGlobPattern } from '../graph/selectors.js';
import { hashFile } from '../utils/hashing.js';
import type { ChangeDetector, ChangeDiff, DetectorOptions, FileChange, FileSnapshot, TurnBaseline } from './types.js';
import { anySelectorMatches, unionIncludePatterns } from './snapshot.js';

interface FsSnapshot {
  files: Map<string, FileSnapshot>;
  degraded: boolean;
}

/**
 * Literal include patterns may name a directory; tinyglobby only walks
 * directories through `**`, so every literal also gets a recursive twin.
 */
function enumerationPatterns(selectors: DetectorOptions['selectors']): string[] {
  const patterns: string[] = [];
  for (const pattern of unionIncludePatterns(selectors)) {
    patterns.push(pattern);
    if (!isGlobPattern(pattern)) patterns.push(`${pattern}/**`);
  }
  return patterns;
}

async function enumerateTracked(cwd: string, options: DetectorOptions): Promise<string[]> {
  const patterns = enumerationPatterns(options.selectors);
  if (patterns.length === 0) return [];
  const found = await glob({
    patterns,
    cwd,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    expandDirectories: false,
  });
  return found.filter((path) => anySelectorMatches(path, options.selectors)).sort();
}

async function captureFsState(cwd: string, options: DetectorOptions): Promise<FsSnapshot> {
  const tracked = await enumerateTracked(cwd, options);
  let degraded = false;
  if (tracked.length > options.maxFiles) {
    degraded = true;
    tracked.length = options.maxFiles;
  }
  const files = new Map<string, FileSnapshot>();
  for (const path of tracked) {
    const hash = await hashFile(`${cwd}/${path}`);
    files.set(path, hash === undefined ? { exists: false } : { exists: true, hash });
  }
  return { files, degraded };
}

/**
 * Filesystem fallback for non-Git workspaces (SPEC §22): the baseline hashes
 * selector-matched files; the stop re-expands the globs (new files are
 * discovered, deletions fall out of the baseline set) and compares hashes.
 */
export function createFilesystemDetector(options: DetectorOptions): ChangeDetector {
  return {
    kind: 'filesystem',

    async captureBaseline(cwd: string): Promise<TurnBaseline> {
      const state = await captureFsState(cwd, options);
      return {
        cwd,
        kind: 'filesystem',
        files: state.files,
        createdAt: Date.now(),
        degraded: state.degraded,
      };
    },

    async computeChanges(cwd: string, baseline: TurnBaseline): Promise<ChangeDiff> {
      const current = await captureFsState(cwd, options);
      const paths = new Set<string>([...baseline.files.keys(), ...current.files.keys()]);
      const changes: FileChange[] = [];

      for (const path of paths) {
        const before = baseline.files.get(path);
        const after = current.files.get(path);
        if (before === undefined && after === undefined) continue;
        if (before === undefined) {
          changes.push({ path, type: 'added' });
          continue;
        }
        if (after === undefined) {
          changes.push({ path, type: 'deleted' });
          continue;
        }
        if (before.exists && after.exists) {
          if (before.hash !== after.hash) changes.push({ path, type: 'modified' });
        } else if (!before.exists && after.exists) {
          changes.push({ path, type: 'added' });
        } else if (before.exists && !after.exists) {
          changes.push({ path, type: 'deleted' });
        }
      }

      return { changes, degraded: baseline.degraded || current.degraded };
    },

    async listFiles(cwd: string): Promise<string[]> {
      return enumerateTracked(cwd, options);
    },
  };
}
