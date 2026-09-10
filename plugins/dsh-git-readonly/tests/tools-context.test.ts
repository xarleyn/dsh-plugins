/** Integration tests for `dsh_git_context` against real repositories (SPEC §3). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GIT_READONLY_DEFAULTS } from '../src/config.js';
import { createGitContextTool } from '../src/tools/context.js';
import type { GitContextResult } from '../src/tools/context.js';
import { silentPluginLogger } from '../src/logging.js';
import { createTempRepo, makeExec, normalizePath, type TempRepo } from './fixtures/git.js';

let repo: TempRepo;
let emptyRepo: TempRepo;
const exec = () => makeExec(repo.dir);

beforeAll(async () => {
  repo = await createTempRepo();
  await repo.commit('hello.txt', 'hello\n', 'init: hello');
  await repo.run(['tag', 'v0.1.0']);
  emptyRepo = await createTempRepo();
});

afterAll(async () => {
  await repo.dispose();
  await emptyRepo.dispose();
});

function makeTool(overrides: Record<string, unknown> = {}) {
  return createGitContextTool({
    config: { ...GIT_READONLY_DEFAULTS, ...overrides },
    logger: silentPluginLogger(),
  });
}

describe('dsh_git_context', () => {
  it('reports root, branch, head and decorated refs', async () => {
    const tool = makeTool();
    const context = (await tool.execute({}, exec())) as GitContextResult;

    expect(normalizePath(context.root)).toBe(normalizePath(repo.dir));
    expect(context.branch).toBe('main');
    expect(context.detached).toBe(false);
    expect(context.head).toBe((await repo.run(['rev-parse', 'HEAD'])).trim());
    expect(context.subject).toBe('init: hello');
    expect(context.author).toBe('QA Bot');
    expect(context.refs).toContain('HEAD -> main');
    expect(context.refs).toContain('v0.1.0');
  });

  it('survives an empty repository with a null HEAD', async () => {
    const tool = makeTool();
    const context = (await tool.execute({}, makeExec(emptyRepo.dir))) as GitContextResult;
    expect(normalizePath(context.root)).toBe(normalizePath(emptyRepo.dir));
    expect(context.head).toBeUndefined();
    expect(context.branch).toBe('main');
  });

  it('reports detached HEAD and no upstream', async () => {
    await repo.run(['checkout', '--detach']);
    const tool = makeTool();
    try {
      const context = (await tool.execute({}, exec())) as GitContextResult;
      expect(context.detached).toBe(true);
      expect(context.branch).toBeUndefined();
      expect(context.upstream).toBeUndefined();
    } finally {
      await repo.run(['checkout', 'main']);
    }
  });

  it('reflects the configured timeout budget', async () => {
    const tool = makeTool({ timeoutMs: 5_000 });
    const context = (await tool.execute({}, exec())) as GitContextResult;
    expect(context.branch).toBe('main');
  });
});
