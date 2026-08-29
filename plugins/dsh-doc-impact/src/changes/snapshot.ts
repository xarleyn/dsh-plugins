import type { FileSelector } from '../config/types.js';
import { matchesSelector } from '../graph/selectors.js';
import { normalizeWorkspacePath } from '../utils/paths.js';
import { hashFile } from '../utils/hashing.js';
import type { DetectorOptions, FileSnapshot } from './types.js';

export function unionIncludePatterns(selectors: FileSelector[]): string[] {
  return [...new Set(selectors.flatMap((selector) => selector.include))];
}

export function anySelectorMatches(path: string, selectors: FileSelector[]): boolean {
  return selectors.some((selector) => matchesSelector(path, selector));
}

/**
 * Build the snapshot for every selector-matched path, hashing file contents.
 * Existence is recorded even past the cap (degraded mode skips hashing, not
 * presence, so add/delete attribution survives oversized repositories).
 */
export async function snapshotWorkspaceFiles(
  cwd: string,
  enumerate: () => Promise<string[]>,
  options: DetectorOptions,
): Promise<{ files: Map<string, FileSnapshot>; degraded: boolean }> {
  const candidates = await enumerate();
  const tracked = candidates.filter((path) => anySelectorMatches(path, options.selectors));
  const files = new Map<string, FileSnapshot>();
  let degraded = false;
  const bounded = tracked.sort();
  if (bounded.length > options.maxFiles) {
    degraded = true;
    bounded.length = options.maxFiles;
  }
  for (const path of bounded) {
    const hash = await hashFile(`${cwd}/${path}`);
    files.set(path, hash === undefined ? { exists: false } : { exists: true, hash });
  }
  return { files, degraded };
}

export { normalizeWorkspacePath };
