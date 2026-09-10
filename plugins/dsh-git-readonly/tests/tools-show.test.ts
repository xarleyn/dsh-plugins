/** Integration tests for `dsh_git_show` against real repositories (SPEC §3). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GIT_READONLY_DEFAULTS } from '../src/config.js';
import { GitToolError } from '../src/errors.js';
import { createGitShowTool } from '../src/tools/show.js';
import type { GitShowResult } from '../src/tools/show.js';
import { silentPluginLogger } from '../src/logging.js';
import { createTempRepo, makeExec, type TempRepo } from './fixtures/git.js';

let repo: TempRepo;
let rootOid: string;
let secondOid: string;

beforeAll(async () => {
  repo = await createTempRepo();
  rootOid = await repo.commit('src/a.txt', 'alpha\n', 'c1: add alpha', );
  secondOid = await repo.commit(
    'src/b.txt',
    'beta\n',
    'c2: add beta\n\nLonger body explaining the task KEY-123.\n',
  );
});

afterAll(async () => {
  await repo.dispose();
});

function makeTool(overrides: Record<string, unknown> = {}) {
  return createGitShowTool({
    config: { ...GIT_READONLY_DEFAULTS, ...overrides },
    logger: silentPluginLogger(),
  });
}

describe('dsh_git_show', () => {
  it('returns structured metadata, files and patch for one commit', async () => {
    const tool = makeTool();
    const shown = (await tool.execute(
      { oid: secondOid.slice(0, 8) },
      makeExec(repo.dir),
    )) as GitShowResult;
    expect(shown.oid).toBe(secondOid);
    expect(shown.subject).toBe('c2: add beta');
    expect(shown.body).toContain('KEY-123');
    expect(shown.parents).toEqual([rootOid]);
    expect(shown.files).toEqual([{ path: 'src/b.txt', additions: 1, deletions: 0 }]);
    expect(shown.patch).toContain('diff --git');
    expect(shown.patch).toContain('beta');
    expect(shown.patchTruncated).toBe(false);
  });

  it('handles the root commit', async () => {
    const tool = makeTool();
    const shown = (await tool.execute({ oid: rootOid }, makeExec(repo.dir))) as GitShowResult;
    expect(shown.parents).toEqual([]);
    expect(shown.files).toEqual([{ path: 'src/a.txt', additions: 1, deletions: 0 }]);
    expect(shown.patch).toContain('diff --git');
  });

  it('restricts files and patch to a repository-relative path', async () => {
    const tool = makeTool();
    const shown = (await tool.execute(
      { oid: secondOid, path: 'src/b.txt' },
      makeExec(repo.dir),
    )) as GitShowResult;
    expect(shown.files).toHaveLength(1);
    expect(shown.patch).toContain('src/b.txt');

    const excluded = (await tool.execute(
      { oid: secondOid, path: 'src/missing.txt' },
      makeExec(repo.dir),
    )) as GitShowResult;
    expect(excluded.files).toEqual([]);
    expect(excluded.patch).toBe('');
  });

  it('omits the patch in statOnly mode', async () => {
    const tool = makeTool();
    const shown = (await tool.execute(
      { oid: secondOid, statOnly: true },
      makeExec(repo.dir),
    )) as GitShowResult;
    expect(shown.files).toHaveLength(1);
    expect(shown.patch).toBe('');
    expect(shown.patchTruncated).toBe(false);
  });

  it('rejects option strings, non-hex refs and unknown ids', async () => {
    const tool = makeTool();
    for (const hostile of ['--help', '-p', 'HEAD', 'main', 'deadbeef -p', 'zzzzzzz']) {
      await expect(tool.execute({ oid: hostile }, makeExec(repo.dir))).rejects.toThrowError(
        GitToolError,
      );
    }
    await expect(tool.execute({ oid: 'deadbee' }, makeExec(repo.dir))).rejects.toThrowError(
      GitToolError,
    );
  });

  it('truncates oversized patches and flags it', async () => {
    const big = 'x'.repeat(400_000);
    const bigOid = await repo.commit('src/big.txt', `${big}\n`, 'c3: big file');
    const tool = makeTool({ patchBytes: 8_192 });
    const shown = (await tool.execute({ oid: bigOid }, makeExec(repo.dir))) as GitShowResult;
    expect(shown.patchTruncated).toBe(true);
    expect(Buffer.byteLength(shown.patch, 'utf8')).toBeLessThan(16_000);
  });
});
