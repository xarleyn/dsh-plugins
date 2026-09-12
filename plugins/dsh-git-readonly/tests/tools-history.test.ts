/** Integration tests for `dsh_git_history` against real repositories (SPEC §3). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GIT_READONLY_DEFAULTS } from '../src/config.js';
import { GitToolError } from '../src/errors.js';
import { createGitHistoryTool } from '../src/tools/history.js';
import type { GitHistoryResult } from '../src/tools/history.js';
import { silentPluginLogger } from '../src/logging.js';
import { createTempRepo, makeExec, type TempRepo } from './fixtures/git.js';

let repo: TempRepo;

beforeAll(async () => {
  repo = await createTempRepo();
  await repo.commit('src/a.txt', 'alpha\n', 'c1: add alpha');
  await repo.commit('src/b.txt', 'TOKEN_CACHE_TTL\n', 'c2: add cache constant');
  await repo.commit('docs/readme.md', 'readme\n', 'c3: add readme');
  await repo.run(['checkout', '-b', 'feature']);
  await repo.commit('src/feature.txt', 'feature\n', 'c4: feature work');
  await repo.commit('src/other.txt', 'other\n', 'c5: other person', { author: 'Other Dev' });
  await repo.run(['checkout', 'main']);
});

afterAll(async () => {
  await repo.dispose();
});

function makeTool(overrides: Record<string, unknown> = {}) {
  return createGitHistoryTool({
    config: { ...GIT_READONLY_DEFAULTS, ...overrides },
    logger: silentPluginLogger(),
  });
}

describe('dsh_git_history', () => {
  it('lists the newest commits first with structured fields', async () => {
    const tool = makeTool();
    const page = (await tool.execute({}, makeExec(repo.dir))) as GitHistoryResult;
    expect(page.count).toBe(3);
    expect(page.truncated).toBe(false);
    expect(page.commits[0]?.subject).toBe('c3: add readme');
    expect(page.commits[2]?.subject).toBe('c1: add alpha');
    for (const commit of page.commits) {
      expect(commit.oid).toMatch(/^[0-9a-f]{40}$/);
      expect(commit.author).toBe('QA Bot');
      expect(commit.authoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:/);
    }
  });

  it('pages with limit/offset and reports truncation', async () => {
    const tool = makeTool();
    const page = (await tool.execute({ limit: 2 }, makeExec(repo.dir))) as GitHistoryResult;
    expect(page.count).toBe(2);
    expect(page.truncated).toBe(true);
    expect(page.commits[0]?.subject).toBe('c3: add readme');

    const offsetPage = (await tool.execute({ limit: 2, offset: 2 }, makeExec(repo.dir))) as GitHistoryResult;
    expect(offsetPage.commits[0]?.subject).toBe('c1: add alpha');
    expect(offsetPage.truncated).toBe(false);
  });

  it('searches commit messages as fixed strings', async () => {
    const tool = makeTool();
    const page = (await tool.execute({ query: 'c2: add' }, makeExec(repo.dir))) as GitHistoryResult;
    expect(page.count).toBe(1);
    expect(page.commits[0]?.subject).toBe('c2: add cache constant');
  });

  it('finds content-introducing commits via the pickaxe', async () => {
    const tool = makeTool();
    const page = (await tool.execute(
      { query: 'TOKEN_CACHE_TTL', search: 'content' },
      makeExec(repo.dir),
    )) as GitHistoryResult;
    expect(page.count).toBe(1);
    expect(page.commits[0]?.subject).toBe('c2: add cache constant');
  });

  it('filters by path, author and all refs', async () => {
    const tool = makeTool();

    const byPath = (await tool.execute({ path: 'src' }, makeExec(repo.dir))) as GitHistoryResult;
    expect(byPath.count).toBe(2);
    for (const commit of byPath.commits) {
      expect(commit.subject.startsWith('c3')).toBe(false);
    }

    const byAuthor = (await tool.execute({ author: 'Other Dev' }, makeExec(repo.dir))) as GitHistoryResult;
    expect(byAuthor.count).toBe(0);
    const headOnly = (await tool.execute({ all: false }, makeExec(repo.dir))) as GitHistoryResult;
    const allRefs = (await tool.execute({ all: true }, makeExec(repo.dir))) as GitHistoryResult;
    expect(allRefs.count).toBeGreaterThan(headOnly.count);
    expect(allRefs.commits.some((commit) => commit.subject === 'c4: feature work')).toBe(true);
  });

  it('rejects invalid inputs before spawning git', async () => {
    const tool = makeTool();
    await expect(
      tool.execute({ search: 'everything' }, makeExec(repo.dir)),
    ).rejects.toThrowError(GitToolError);
    await expect(tool.execute({ limit: 0 }, makeExec(repo.dir))).rejects.toThrowError(GitToolError);
    await expect(tool.execute({ path: '../outside' }, makeExec(repo.dir))).rejects.toThrowError(
      GitToolError,
    );
  });

  it('respects the configured page ceiling', async () => {
    const tool = makeTool({ historyMaxLimit: 2 });
    const page = (await tool.execute({ limit: 100 }, makeExec(repo.dir))) as GitHistoryResult;
    expect(page.count).toBe(2);
  });
});
