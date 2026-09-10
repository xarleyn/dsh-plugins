/**
 * Repository resolution and commit canonicalization.
 *
 * The tools operate on exactly one repository per call: the one containing
 * the session working directory. There is no fallback to the host process
 * cwd — a session without a pinned cwd fails closed instead of silently
 * gaining git access to wherever the harness happens to run.
 */

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
      `the session working directory is not inside a git work tree (${sessionCwd})`,
    );
  }
  return root;
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
