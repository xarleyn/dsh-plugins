import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface GitStatusEntry {
  /** Staged status letter (' ' when none). */
  x: string;
  /** Worktree status letter (' ' when clean). */
  y: string;
  /** One or two paths: `[to]` or `[to, from]` for renames/copies. */
  paths: string[];
}

export interface GitNameStatusEntry {
  /** Single-letter change kind: A, M, D, R, T, etc. (score suffix stripped). */
  status: string;
  /** `[path]` or `[to, from]` for renames/copies. */
  paths: string[];
}

export class GitError extends Error {
  constructor(args: readonly string[], exitCode: number | undefined, stderr: string) {
    super(`git ${args.join(' ')} failed (exit ${exitCode ?? '?'}): ${stderr.trim()}`);
    this.name = 'GitError';
  }
}function runGit(cwd: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new GitError(args, code ?? undefined, Buffer.concat(stderr).toString('utf8')));
    });
  });
}

/** Run git treating exit code 128 "not a repository / bad revision" as `undefined`. */
async function runGitOptional(cwd: string, args: readonly string[]): Promise<Buffer | undefined> {
  try {
    return await runGit(cwd, args);
  } catch (error) {
    if (error instanceof GitError && error.message.includes('exit 128')) return undefined;
    throw error;
  }
}

export async function isGitWorktree(cwd: string): Promise<boolean> {
  const out = await runGitOptional(cwd, ['rev-parse', '--is-inside-work-tree']);
  return out?.toString('utf8').trim() === 'true';
}

export async function resolveHead(cwd: string): Promise<string | undefined> {
  const out = await runGitOptional(cwd, ['rev-parse', 'HEAD']);
  const head = out?.toString('utf8').trim();
  return head === '' ? undefined : head;
}

function splitNul(buffer: Buffer): string[] {
  const text = buffer.toString('utf8');
  if (text === '') return [];
  return text.split('\0').slice(0, -1);
}

/** `git status --porcelain=v1 -z --untracked-files=all`; never mutates the index. */
export async function statusEntries(cwd: string): Promise<GitStatusEntry[]> {
  const out = await runGit(cwd, [
    '--no-optional-locks',
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  const fields = splitNul(out);
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < fields.length;) {
    const record = fields[index];
    index += 1;
    if (record === undefined || record.length < 4) continue;
    const x = record[0] as string;
    const y = record[1] as string;
    const first = record.slice(3);
    // Rename/copy records carry the destination first, then the original path.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const second = fields[index];
      index += 1;
      entries.push({ x, y, paths: second === undefined ? [first] : [first, second] });
    } else {
      entries.push({ x, y, paths: [first] });
    }
  }
  return entries;
}

/** `git diff --name-status -z` between two commits (rename detection on). */
export async function nameStatusRange(cwd: string, from: string, to: string): Promise<GitNameStatusEntry[]> {
  const out = await runGit(cwd, ['diff', '--name-status', '-z', '-M', from, to]);
  const fields = splitNul(out);
  const entries: GitNameStatusEntry[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    index += 1;
    if (status === undefined || status === '') continue;
    const kind = (status.match(/^([A-Z])/u)?.[1]) ?? status;
    const first = fields[index];
    index += 1;
    if (first === undefined) continue;
    if (kind === 'R' || kind === 'C') {
      const second = fields[index];
      index += 1;
      entries.push({ status: kind, paths: second === undefined ? [first] : [first, second] });
    } else {
      entries.push({ status: kind, paths: [first] });
    }
  }
  return entries;
}

/**
 * Tracked + untracked (but gitignore-respecting) file paths. Used for
 * target-selector materialization; contents are never read.
 */
export async function listGitFiles(cwd: string): Promise<string[]> {
  const out = await runGit(cwd, [
    '--no-optional-locks',
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  return splitNul(out);
}

export { runGit };

/** The well-known empty-tree object id, used to diff against an unborn HEAD. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function absoluteWorkspacePath(cwd: string, workspacePath: string): string {
  return join(cwd, ...workspacePath.split('/'));
}
