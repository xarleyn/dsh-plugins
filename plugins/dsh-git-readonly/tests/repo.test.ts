/** Fail-closed session/repository resolution (SPEC §5). */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GitToolError } from '../src/errors.js';
import {
  canonicalizeCommit,
  requireSessionCwd,
  resolveRepositoryRoot,
} from '../src/git/repo.js';
import { runGit } from '../src/git/runner.js';
import { createTempRepo, makeExec, normalizePath, type TempRepo } from './fixtures/git.js';

let repo: TempRepo;
let plainDir: string;

beforeAll(async () => {
  repo = await createTempRepo();
  await repo.commit('hello.txt', 'hello\n', 'init');
  plainDir = await mkdtemp(join(tmpdir(), 'dsh-git-readonly-plain-'));
});

afterAll(async () => {
  await repo.dispose();
  await rm(plainDir, { recursive: true, force: true });
});

describe('requireSessionCwd', () => {
  it('fails closed without an agent session', () => {
    expect(() => requireSessionCwd({})).toThrowError(GitToolError);
    expect(() => requireSessionCwd({ agent: undefined })).toThrowError(GitToolError);
  });

  it('fails closed when the session header has no cwd', () => {
    expect(() => requireSessionCwd(makeExec(undefined))).toThrowError(GitToolError);
    expect(() => requireSessionCwd(makeExec(''))).toThrowError(
      GitToolError,
    );
  });

  it('returns the pinned cwd', () => {
    expect(requireSessionCwd(makeExec(repo.dir))).toBe(repo.dir);
  });
});

describe('resolveRepositoryRoot', () => {
  it('resolves the work-tree root from the session directory', async () => {
    const root = await resolveRepositoryRoot(runGit, repo.dir, { timeoutMs: 10_000 });
    expect(normalizePath(root)).toBe(normalizePath(repo.dir));
  });

  it('fails closed outside a repository', async () => {
    await expect(
      resolveRepositoryRoot(runGit, plainDir, { timeoutMs: 10_000 }),
    ).rejects.toThrowError(GitToolError);
  });
});

describe('canonicalizeCommit', () => {
  it('canonicalizes an abbreviated id to the full commit oid', async () => {
    const root = await resolveRepositoryRoot(runGit, repo.dir, { timeoutMs: 10_000 });
    const full = (await repo.run(['rev-parse', 'HEAD'])).trim();
    const canonical = await canonicalizeCommit(runGit, root, full.slice(0, 8), {
      timeoutMs: 10_000,
    });
    expect(canonical).toBe(full);
  });

  it('rejects well-formed hexadecimal ids that do not exist', async () => {
    const root = await resolveRepositoryRoot(runGit, repo.dir, { timeoutMs: 10_000 });
    await expect(
      canonicalizeCommit(runGit, root, 'deadbee', { timeoutMs: 10_000 }),
    ).rejects.toThrowError(GitToolError);
  });
});
