import type { ChangeDetectionMode } from '../config/types.js';
import { isGitWorktree } from './git.js';
import { createGitDetector } from './git-detector.js';
import { createFilesystemDetector } from './filesystem-detector.js';
import type { ChangeDetector, DetectorOptions } from './types.js';

export { createGitDetector, createFilesystemDetector };

/**
 * Change-detection selection (SPEC §22-§24): `auto` prefers the Git baseline
 * detector and falls back to the filesystem snapshot outside repositories;
 * explicit `git` degrades the same way instead of failing; `filesystem`
 * always snapshots.
 */
export async function createDetector(
  mode: ChangeDetectionMode,
  cwd: string,
  options: DetectorOptions,
): Promise<ChangeDetector> {
  if (mode !== 'filesystem' && (await isGitWorktree(cwd))) return createGitDetector(options);
  return createFilesystemDetector(options);
}
