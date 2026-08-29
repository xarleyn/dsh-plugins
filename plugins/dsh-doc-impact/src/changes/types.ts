import type { FileSelector } from '../config/types.js';

/** Workspace-relative POSIX path of one file whose state changed during a turn. */
export type FileChangeType = 'added' | 'modified' | 'deleted';

export interface FileChange {
  readonly path: string;
  readonly type: FileChangeType;
}

/** Existence plus content hash captured for one path at a point in time. */
export interface FileSnapshot {
  readonly exists: boolean;
  readonly hash?: string;
  /** True when git reports the path as untracked (never committed). */
  readonly untracked?: true;
}

/**
 * State of the tracked workspace at the start of a turn (or session). The
 * detector diffs against this instead of `git diff HEAD`, so pre-existing
 * user changes are never attributed to the agent.
 */
export interface TurnBaseline {
  readonly cwd: string;
  readonly kind: 'git' | 'filesystem';
  /** HEAD commit at baseline; `undefined` for non-git workspaces or unborn branches. */
  readonly head?: string;
  /** Content-hash state of every path that was already dirty at baseline. */
  readonly files: Map<string, FileSnapshot>;
  readonly createdAt: number;
  /** True when the snapshot hit `maxSnapshotFiles` and degraded to a partial capture. */
  readonly degraded: boolean;
}

export interface ChangeDiff {
  readonly changes: FileChange[];
  readonly degraded: boolean;
}

/**
 * Filesystem enumeration for target-selector materialization. Returns every
 * workspace-relative path matching any of the selectors, without contents.
 */
export interface FileEnumerator {
  listFiles(cwd: string): Promise<string[]>;
}

export interface ChangeDetector extends FileEnumerator {
  readonly kind: 'git' | 'filesystem';
  captureBaseline(cwd: string): Promise<TurnBaseline>;
  computeChanges(cwd: string, baseline: TurnBaseline): Promise<ChangeDiff>;
}

export interface DetectorOptions {
  /** Configured selectors; a file is tracked when ANY selector matches it. */
  selectors: FileSelector[];
  maxFiles: number;
}
