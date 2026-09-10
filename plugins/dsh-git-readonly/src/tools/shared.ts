/**
 * Shared plumbing of the dsh_git_* tools: the bound runner and the
 * git-failure-to-tool-error mapping. Output of git goes to the model only
 * through the structured results; log records never carry content.
 */

import { GitToolError } from '../errors.js';
import type { ResolvedGitReadonlyConfig } from '../config.js';
import type { GitRunner } from '../git/repo.js';
import { runGit } from '../git/runner.js';
import type { PluginLoggerLike } from '../logging.js';

export interface GitToolDeps {
  readonly config: ResolvedGitReadonlyConfig;
  readonly logger: PluginLoggerLike;
  /** Test seam: git program override (defaults to `config.gitPath`). */
  readonly program?: string;
  /** Test seam: arguments between the program and the git subcommand. */
  readonly programPrefixArgs?: readonly string[];
}

/** Bind a hardened runner to the resolved configuration. */
export function createBoundRunner(deps: GitToolDeps): GitRunner {
  return async (argv, options) => {
    const result = await runGit(argv, {
      ...options,
      program: deps.program ?? deps.config.gitPath,
      programPrefixArgs: deps.programPrefixArgs,
    });
    deps.logger.debug('git.run', {
      subcommand: argv[0] ?? '',
      exitCode: result.exitCode,
      truncated: result.truncated,
      timedOut: result.timedOut,
    });
    return result;
  };
}

function stderrTail(stderr: string): string {
  const tail = stderr.trim();
  if (tail === '') return 'git produced no error output';
  return tail.length > 1_000 ? `…${tail.slice(-1_000)}` : tail;
}

/**
 * Turn a failed git result into a typed error for the model.
 * `context` names what the invocation was doing (e.g. "history lookup").
 * A result killed at the byte cap is not a failure — the partial output is
 * the expected truncation behavior and is flagged by `truncated`.
 */
export function expectGitOk(result: Awaited<ReturnType<typeof runGit>>, context: string): void {
  if (result.timedOut) {
    throw new GitToolError('git-timeout', `${context} exceeded the configured time budget`);
  }
  if (result.truncated) return;
  if (result.exitCode !== 0) {
    throw new GitToolError('git-failed', `${context} failed: ${stderrTail(result.stderr)}`);
  }
}
