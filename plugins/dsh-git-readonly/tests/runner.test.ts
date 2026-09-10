/** Unit tests for the hardened git runner: caps, timeout, kill, spawn failure (SPEC §6). */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GitToolError } from '../src/errors.js';
import { GIT_HARDENING_PREFIX, runGit } from '../src/git/runner.js';

let scratch: string;
let stubPath: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'dsh-git-readonly-runner-'));
  stubPath = join(scratch, 'stub.mjs');
  await writeFile(
    stubPath,
    [
      'const args = process.argv.slice(2);',
      'if (args.includes("mode=sleep")) {',
      '  setTimeout(() => { process.stdout.write("done"); process.exit(0); }, 30_000);',
      '} else if (args.includes("mode=big")) {',
      '  process.stdout.write("x".repeat(2_000_000));',
      '  process.exit(0);',
      '} else if (args.includes("mode=fail")) {',
      '  process.stderr.write("simulated failure");',
      '  process.exit(3);',
      '} else {',
      '  process.stdout.write(JSON.stringify(args));',
      '  process.exit(0);',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const stubRun = (argv: readonly string[], overrides: Record<string, unknown> = {}) =>
  runGit(argv, {
    cwd: scratch,
    timeoutMs: 10_000,
    maxBytes: 65_536,
    program: process.execPath,
    programPrefixArgs: [stubPath],
    ...overrides,
  });

describe('runGit', () => {
  it('passes the subcommand and hardening prefix to the program', async () => {
    const result = await stubRun(['mode=echo']);
    const args = JSON.parse(result.stdout) as string[];
    expect(args.slice(0, GIT_HARDENING_PREFIX.length)).toEqual([...GIT_HARDENING_PREFIX]);
    expect(args).toContain('mode=echo');
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  it('kills the process at the byte cap and flags truncation', async () => {
    const result = await stubRun(['mode=big'], { maxBytes: 65_536 });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(65_536);
  });

  it('kills the process at the timeout and flags it', async () => {
    const result = await stubRun(['mode=sleep'], { timeoutMs: 400 });
    expect(result.timedOut).toBe(true);
  });

  it('returns non-zero exits for the caller to map', async () => {
    const result = await stubRun(['mode=fail']);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('simulated failure');
  });

  it('fails with a typed error when the program cannot be spawned', async () => {
    await expect(
      runGit(['rev-parse'], {
        cwd: scratch,
        timeoutMs: 10_000,
        maxBytes: 4_096,
        program: 'dsh-git-readonly-definitely-not-an-executable',
      }),
    ).rejects.toThrowError(GitToolError);
  });
});
