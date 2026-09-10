/**
 * Real-git test fixtures: throwaway repositories, deterministic commits, and
 * a byte-level repository snapshot used by the mutation tests (SPEC §9).
 *
 * Snapshots cover the work tree and every `.git` file except reflogs, so a
 * mutation (refs, index, config, packed objects) is detectable byte-for-byte.
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

async function hashTree(root: string, skip: (relPath: string) => boolean): Promise<string> {
  const hash = createHash('sha256');
  const walk = async (relative: string): Promise<void> => {
    if (skip(relative)) return;
    const absolute = relative === '' ? root : join(root, relative);
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (skip(entryRel)) continue;
      if (entry.isDirectory()) {
        await walk(entryRel);
        continue;
      }
      const content = await readFile(join(root, entryRel));
      hash.update(`${entryRel}\n${createHash('sha256').update(content).digest('hex')}\n`);
    }
  };
  await walk('');
  return hash.digest('hex');
}

/** Hash of the whole work tree (relative paths + file content hashes). */
export function snapshotWorktree(dir: string): Promise<string> {
  return hashTree(dir, (relPath) => relPath === '.git' || relPath.startsWith('.git/'));
}

/**
 * Hash of the git directory except reflogs: refs, index, config, HEAD and
 * object files must stay byte-identical across read-only tool calls.
 */
export function snapshotGitDir(dir: string): Promise<string> {
  return hashTree(join(dir, '.git'), (relPath) => relPath === 'logs' || relPath.startsWith('logs/'));
}

export async function snapshotRepo(dir: string): Promise<string> {
  const worktree = await snapshotWorktree(dir);
  const gitDir = await snapshotGitDir(dir);
  return createHash('sha256').update(`${worktree}\n${gitDir}`).digest('hex');
}

/** Structural tool-execution context for a pinned session cwd. */
export function makeExec(cwd?: string): ToolRunContext {
  if (cwd === undefined) return {} as unknown as ToolRunContext;
  return { agent: { session: { header: { cwd } } } } as unknown as ToolRunContext;
}

export { existsSync };
