/** Integration tests for `dsh_git_blame` against real repositories (SPEC §3). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GIT_READONLY_DEFAULTS } from '../src/config.js';
import { GitToolError } from '../src/errors.js';
import { createGitBlameTool } from '../src/tools/blame.js';
import type { GitBlameResult } from '../src/tools/blame.js';
import { silentPluginLogger } from '../src/logging.js';
import { createTempRepo, makeExec, type TempRepo } from './fixtures/git.js';

let repo: TempRepo;
const oids: string[] = [];

beforeAll(async () => {
  repo = await createTempRepo();
  oids.push(await repo.commit('lines.txt', 'line one\n', 'c1: line one'));
  oids.push(await repo.commit('lines.txt', 'line one\nline two\n', 'c2: line two'));
  oids.push(await repo.commit('lines.txt', 'line one\nline two\nline three\n', 'c3: line three'));
});

afterAll(async () => {
  await repo.dispose();
});

function makeTool(overrides: Record<string, unknown> = {}) {
  return createGitBlameTool({
    config: { ...GIT_READONLY_DEFAULTS, ...overrides },
    logger: silentPluginLogger(),
  });
}

describe('dsh_git_blame', () => {
  it('attributes each line to the commit that introduced it', async () => {
    const tool = makeTool();
    const blame = (await tool.execute({ file: 'lines.txt' }, makeExec(repo.dir))) as GitBlameResult;
    expect(blame.lines).toHaveLength(3);
    expect(blame.lines[0]).toMatchObject({ line: 1, oid: oids[0], summary: 'c1: line one' });
    expect(blame.lines[1]).toMatchObject({ line: 2, oid: oids[1], summary: 'c2: line two' });
    expect(blame.lines[2]).toMatchObject({ line: 3, oid: oids[2], summary: 'c3: line three' });
    expect(blame.lines[0]?.content).toBe('line one');
    expect(blame.lines[2]?.author).toBe('QA Bot');
    expect(blame.truncated).toBe(false);
  });

  it('honours line windows', async () => {
    const tool = makeTool();
    const blame = (await tool.execute(
      { file: 'lines.txt', fromLine: 2, toLine: 3 },
      makeExec(repo.dir),
    )) as GitBlameResult;
    expect(blame.fromLine).toBe(2);
    expect(blame.toLine).toBe(3);
    expect(blame.lines.map((line) => line.line)).toEqual([2, 3]);
  });

  it('caps the window and reports truncation for open-ended reads', async () => {
    const tool = makeTool({ blameMaxLines: 2 });
    const blame = (await tool.execute({ file: 'lines.txt' }, makeExec(repo.dir))) as GitBlameResult;
    expect(blame.lines).toHaveLength(2);
    expect(blame.truncated).toBe(true);
  });

  it('blames a historical revision', async () => {
    const tool = makeTool();
    const blame = (await tool.execute(
      { file: 'lines.txt', oid: oids[1] },
      makeExec(repo.dir),
    )) as GitBlameResult;
    expect(blame.lines).toHaveLength(2);
    expect(blame.lines[1]?.oid).toBe(oids[1]);
  });

  it('rejects traversal, option-like files and bad ids before spawning', async () => {
    const tool = makeTool();
    await expect(tool.execute({ file: '../secret.txt' }, makeExec(repo.dir))).rejects.toThrowError(
      GitToolError,
    );
    await expect(tool.execute({ file: '-flag' }, makeExec(repo.dir))).rejects.toThrowError(
      GitToolError,
    );
    await expect(
      tool.execute({ file: 'lines.txt', oid: '--help' }, makeExec(repo.dir)),
    ).rejects.toThrowError(GitToolError);
  });

  it('fails with a typed error for a missing file', async () => {
    const tool = makeTool();
    await expect(
      tool.execute({ file: 'no-such-file.txt' }, makeExec(repo.dir)),
    ).rejects.toThrowError(GitToolError);
  });
});
