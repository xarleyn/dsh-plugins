/**
 * Repository resolution and commit canonicalization.
 *
 * The tools operate on exactly one repository per call: the one selected
 * from the session directory or the configured repository roots. There is no
 * fallback to the host process cwd — a session without a pinned cwd fails
 * closed instead of silently gaining git access to wherever the harness runs.
 */

import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ToolRunContext } from '@deepseek-ai/dsh-tools';

import { GitToolError } from '../errors.js';
import { FULL_OID_PATTERN } from './validate.js';
import type { GitRunResult } from './runner.js';

/** Execution context handed to tool bodies (structural subset for tests). */
export type ToolExec = Pick<ToolRunContext, 'agent'>;

/** Runner bound by the tools: argv + working directory in, git result out. */
export type GitRunner = (
  argv: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number; readonly maxBytes: number },
) => Promise<GitRunResult>;

/** Extract the calling session's working directory, failing closed. */
export function requireSessionCwd(exec: ToolExec): string {
  const agent = exec.agent;
  if (agent === undefined) {
    throw new GitToolError('no-session-cwd', 'this tool requires a calling agent session');
  }
  const cwd = agent.session.header.cwd;
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new GitToolError(
      'no-session-cwd',
      'this session has no working directory; git inspection is not available',
    );
  }
  return cwd;
}

/** Resolve the work-tree root containing `sessionCwd`, failing closed. */
export async function resolveRepositoryRoot(
  run: GitRunner,
  sessionCwd: string,
  options: { timeoutMs: number },
): Promise<string> {
  const result = await run(['rev-parse', '--show-toplevel'], {
    cwd: sessionCwd,
    timeoutMs: options.timeoutMs,
    maxBytes: 64 * 1024,
  });
  const root = result.stdout.trim();
  if (result.exitCode !== 0 || root === '') {
    throw new GitToolError(
      'not-a-git-repository',
      `the selected directory is not inside a git work tree (${sessionCwd}); ` +
        'pass repository to select a repository inside the session directory or an operator-configured repository root',
    );
  }
  return root;
}

function pathIsInside(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

async function canonicalDirectory(input: string, label: string): Promise<string> {
  try {
    const canonical = await realpath(input);
    if (!(await stat(canonical)).isDirectory()) throw new Error('not a directory');
    return canonical;
  } catch {
    throw new GitToolError(
      'invalid-repository',
      `${label} is not an existing directory (${input})`,
    );
  }
}

/**
 * Resolve the repository selected by one tool call without granting a general
 * filesystem path escape. Omitting `requested` prefers the session repository
 * and falls back only when there is exactly one configured root. An explicit
 * path and its resolved work-tree root must both remain inside the session
 * directory or an operator-configured root.
 */
export async function resolveToolRepository(
  run: GitRunner,
  exec: ToolExec,
  requested: unknown,
  options: { readonly timeoutMs: number; readonly repositoryRoots: readonly string[] },
): Promise<string> {
  const sessionCwd = requireSessionCwd(exec);
  if (requested === undefined || requested === null) {
    try {
      return await resolveRepositoryRoot(run, sessionCwd, { timeoutMs: options.timeoutMs });
    } catch (error) {
      if (!(error instanceof GitToolError) || error.code !== 'not-a-git-repository') throw error;
      if (options.repositoryRoots.length === 1) {
        return resolveToolRepository(run, exec, options.repositoryRoots[0], options);
      }
      if (options.repositoryRoots.length > 1) {
        throw new GitToolError(
          'not-a-git-repository',
          `the session directory is not inside a git work tree (${sessionCwd}); ` +
            `select one configured repository root: ${options.repositoryRoots.join(', ')}`,
        );
      }
      throw error;
    }
  }
  if (typeof requested !== 'string' || requested.trim() === '') {
    throw new GitToolError('invalid-repository', 'repository must be a non-empty path');
  }

  const canonicalSession = await canonicalDirectory(sessionCwd, 'the session working directory');
  const configuredRoots = await Promise.all(
    options.repositoryRoots.map((root) => canonicalDirectory(root, 'a configured repository root')),
  );
  const allowedRoots = [canonicalSession, ...configuredRoots];
  const selected = await canonicalDirectory(
    path.resolve(sessionCwd, requested.trim()),
    'repository',
  );
  if (!allowedRoots.some((root) => pathIsInside(selected, root))) {
    throw new GitToolError(
      'repository-not-allowed',
      'repository is outside the session directory and configured repository roots',
    );
  }

  const repoRoot = await resolveRepositoryRoot(run, selected, { timeoutMs: options.timeoutMs });
  const canonicalRepoRoot = await canonicalDirectory(repoRoot, 'the resolved repository root');
  if (!allowedRoots.some((root) => pathIsInside(canonicalRepoRoot, root))) {
    throw new GitToolError(
      'repository-not-allowed',
      'the resolved git work tree escapes the allowed repository root',
    );
  }
  return canonicalRepoRoot;
}

/**
 * Canonicalize a validated hexadecimal commit id to the full object id of an
 * existing commit. The `^{commit}` peel plus `--end-of-options` mean the
 * model can only ever name a commit that git itself resolves.
 */
export async function canonicalizeCommit(
  run: GitRunner,
  repoRoot: string,
  oid: string,
  options: { timeoutMs: number },
): Promise<string> {
  const result = await run(['rev-parse', '--verify', '--end-of-options', `${oid}^{commit}`], {
    cwd: repoRoot,
    timeoutMs: options.timeoutMs,
    maxBytes: 64 * 1024,
  });
  const full = result.stdout.trim();
  if (result.exitCode !== 0 || !FULL_OID_PATTERN.test(full)) {
    throw new GitToolError('invalid-oid', `no commit matches "${oid}" in this repository`);
  }
  return full;
}
