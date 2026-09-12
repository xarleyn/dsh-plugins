/**
 * Real-git test fixtures: throwaway repositories, deterministic commits, and
 * a byte-level repository snapshot used by the mutation tests (SPEC §9).
 *
 * Snapshots cover the work tree and every `.git` file except reflogs, so a
 * mutation (refs, index, config, packed objects) is detectable byte-for-byte.
 *
 * The repositories are also pinned against git's *own* background work: see
 * `createTempRepo` for why auto-maintenance has to stay off for a snapshot
 * comparison to mean anything.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';

export function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

export interface TempRepo {
  readonly dir: string;
  /** Run git in the repo (extra `-c` overrides allowed via args). */
  run(args: readonly string[]): Promise<string>;
  /** Write one file, stage everything, and commit. Returns the full oid. */
  commit(relPath: string, content: string, message: string, options?: { author?: string }): Promise<string>;
  writeFile(relPath: string, content: string): Promise<void>;
  runOutside(args: readonly string[], cwd: string): Promise<string>;
  dispose(): Promise<void>;
}

export async function createTempRepo(): Promise<TempRepo> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-readonly-'));
  const runGit = (args: readonly string[], cwd: string) =>
    new Promise<string>((resolve, reject) => {
      execFile('git', [...args], { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`git ${args.join(' ')} failed: ${stderr || error.message}`));
          return;
        }
        resolve(stdout);
      });
    });

  await runGit(['init', '-b', 'main'], dir);
  await runGit(['config', 'user.name', 'QA Bot'], dir);
  await runGit(['config', 'user.email', 'qa@example.com'], dir);
  await runGit(['config', 'core.autocrlf', 'false'], dir);
  await runGit(['config', 'commit.gpgsign', 'false'], dir);
  // Auto-maintenance off. `git commit` ends with a detached
  // `git maintenance run --auto`, which takes `.git/objects/maintenance.lock`
  // for as long as it lives. On Linux the daemon outlives the commit (and,
  // on a loaded CI runner, the test's own snapshot window), so a file that no
  // tool wrote lands in one snapshot and not the other. Windows cannot fork
  // there, which is why the flake only ever showed up in CI. What the
  // mutation suite proves is that the *tools* never write; git's background
  // housekeeping is not part of that promise.
  await runGit(['config', 'maintenance.auto', 'false'], dir);
  await runGit(['config', 'gc.auto', '0'], dir);

  const repo: TempRepo = {
    dir,
    run: (args) => runGit(args, dir),
    runOutside: (args, cwd) => runGit(args, cwd),
    async writeFile(relPath, content) {
      const absolute = join(dir, relPath);
      await mkdir(join(absolute, '..'), { recursive: true });
      await writeFile(absolute, content, 'utf8');
    },
    async commit(relPath, content, message, options) {
      await repo.writeFile(relPath, content);
      await runGit(['add', '-A'], dir);
      const authorArgs =
        options?.author === undefined ? [] : ['-c', `user.name=${options.author}`];
      await runGit([...authorArgs, 'commit', '-m', message], dir);
      return (await runGit(['rev-parse', 'HEAD'], dir)).trim();
    },
    async dispose() {
      await rm(dir, { recursive: true, force: true });
    },
  };
  return repo;
}

/** Per-file content digests of one tree: repository-relative path → sha256. */
export type TreeManifest = ReadonlyMap<string, string>;

async function buildManifest(
  root: string,
  prefix: string,
  skip: (relPath: string) => boolean,
): Promise<TreeManifest> {
  const manifest = new Map<string, string>();
  const walk = async (relative: string): Promise<void> => {
    if (skip(relative)) return;
    const absolute = relative === '' ? root : join(root, relative);
    const entries = await readdir(absolute, { withFileTypes: true });
    // The manifest must not depend on the order readdir happens to return.
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const entryRel = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (skip(entryRel)) continue;
      if (entry.isDirectory()) {
        await walk(entryRel);
        continue;
      }
      const content = await readFile(join(root, entryRel));
      manifest.set(`${prefix}${entryRel}`, createHash('sha256').update(content).digest('hex'));
    }
  };
  await walk('');
  return manifest;
}

/** Work tree manifest; paths are relative to the repository root. */
export function worktreeManifest(dir: string): Promise<TreeManifest> {
  return buildManifest(dir, '', (relPath) => relPath === '.git' || relPath.startsWith('.git/'));
}

/** Git-directory manifest minus reflogs; paths are prefixed with `.git/`. */
export function gitDirManifest(dir: string): Promise<TreeManifest> {
  return buildManifest(join(dir, '.git'), '.git/', (relPath) => relPath === 'logs' || relPath.startsWith('logs/'));
}

/** Work tree plus git directory as one path→digest map. */
export async function repoManifest(dir: string): Promise<TreeManifest> {
  return new Map([...(await worktreeManifest(dir)), ...(await gitDirManifest(dir))]);
}

/** Stable digest of a manifest: two equal trees digest equally. */
export function manifestDigest(manifest: TreeManifest): string {
  const hash = createHash('sha256');
  for (const path of [...manifest.keys()].sort()) {
    hash.update(`${path}\n${manifest.get(path)}\n`);
  }
  return hash.digest('hex');
}

/**
 * Which files were added, removed or changed between two manifests. An empty
 * list means the trees are byte-identical; every other entry names the file
 * that moved, so a failed snapshot assertion reports what changed instead of
 * printing two opaque digests.
 */
export function diffManifests(before: TreeManifest, after: TreeManifest): string[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const differences: string[] = [];
  for (const path of paths) {
    const was = before.get(path);
    const now = after.get(path);
    if (was === now) continue;
    if (was === undefined) differences.push(`added ${path}`);
    else if (now === undefined) differences.push(`removed ${path}`);
    else differences.push(`changed ${path}`);
  }
  return differences;
}

/** Hash of the whole work tree (relative paths + file content hashes). */
export async function snapshotWorktree(dir: string): Promise<string> {
  return manifestDigest(await worktreeManifest(dir));
}

/**
 * Hash of the git directory except reflogs: refs, index, config, HEAD and
 * object files must stay byte-identical across read-only tool calls.
 */
export async function snapshotGitDir(dir: string): Promise<string> {
  return manifestDigest(await gitDirManifest(dir));
}

export async function snapshotRepo(dir: string): Promise<string> {
  return manifestDigest(await repoManifest(dir));
}

/** Structural tool-execution context for a pinned session cwd. */
export function makeExec(cwd?: string): ToolRunContext {
  if (cwd === undefined) return {} as unknown as ToolRunContext;
  return { agent: { session: { header: { cwd } } } } as unknown as ToolRunContext;
}

export { existsSync };
