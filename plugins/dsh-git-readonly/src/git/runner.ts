/**
 * Hardened git subprocess runner.
 *
 * Every git invocation of the plugin goes through here. The contract:
 *
 * - argv array only — the command line is built by the plugin, never by the
 *   model, and no shell is involved;
 * - hardening flags are always prepended (`--no-pager`, fsmonitor off,
 *   quotepath off) so repo-controlled config cannot turn a read into an
 *   execution or a write;
 * - the environment is filtered and forced (see `buildGitEnv`);
 * - output is byte-capped and the process is killed when the cap or the
 *   timeout hits, with the truncation surfaced to the caller.
 */

import { spawn } from 'node:child_process';

import { GitToolError } from '../errors.js';
import { buildGitEnv } from './env.js';

/** Hardening arguments prepended to every git invocation. */
export const GIT_HARDENING_PREFIX: readonly string[] = [
  '--no-pager',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.quotepath=false',
];

export interface GitRunOptions {
  /** Working directory for the invocation (session cwd or repository root). */
  readonly cwd: string;
  readonly timeoutMs: number;
  /** Maximum stdout bytes retained; the process is killed beyond this. */
  readonly maxBytes: number;
  /** Maximum stderr bytes retained (collection stops, process keeps running). */
  readonly stderrMaxBytes?: number;
  /**
   * Git executable; defaults to `git`. Test seam — paired with
   * `programPrefixArgs` it lets tests substitute a stub program.
   */
  readonly program?: string;
  /**
   * Arguments placed between the program and the git subcommand. Test seam
   * for stub programs; empty in production.
   */
  readonly programPrefixArgs?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface GitRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  /** The run hit the byte cap and was killed early. */
  readonly truncated: boolean;
  /** The run hit the timeout and was killed. */
  readonly timedOut: boolean;
}

const DEFAULT_STDERR_MAX_BYTES = 16 * 1024;
const KILL_ESCALATION_MS = 500;

export async function runGit(argv: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
  const program = options.program ?? 'git';
  const args = [
    ...(options.programPrefixArgs ?? []),
    ...GIT_HARDENING_PREFIX,
    ...argv,
  ];

  return await new Promise<GitRunResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(program, [...args], {
        cwd: options.cwd,
        env: buildGitEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      reject(
        new GitToolError(
          'git-failed',
          `git executable "${program}" could not be spawned: ${(error as Error).message}`,
        ),
      );
      return;
    }

    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutCap = Math.max(1, Math.floor(options.maxBytes));
    const stderrCap = Math.max(1, Math.floor(options.stderrMaxBytes ?? DEFAULT_STDERR_MAX_BYTES));

    const kill = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill();
      const escalation = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, KILL_ESCALATION_MS);
      escalation.unref?.();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, Math.max(1, Math.floor(options.timeoutMs)));
    timer.unref?.();

    const onAbort = () => kill();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= stdoutCap) {
        truncated = true;
        kill();
        return;
      }
      const remaining = stdoutCap - stdoutBytes;
      if (chunk.length > remaining) {
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes = stdoutCap;
        truncated = true;
        kill();
        return;
      }
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes >= stderrCap) return;
      const remaining = stderrCap - stderrBytes;
      if (chunk.length > remaining) {
        stderrChunks.push(chunk.subarray(0, remaining));
        stderrBytes = stderrCap;
        return;
      }
      stderrChunks.push(chunk);
      stderrBytes += chunk.length;
    });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode,
        truncated,
        timedOut,
      });
    };

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(
        new GitToolError(
          'git-failed',
          `git executable "${program}" could not be spawned: ${error.message}`,
        ),
      );
    });

    child.on('close', (code) => {
      finish(code);
    });
  });
}
