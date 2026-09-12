/**
 * Mutation and hardening suite (SPEC §9): the model-facing read guarantee.
 *
 * Every tool call must leave the repository byte-identical (refs, index,
 * config, objects, work tree), must never trigger repo-controlled helpers
 * (external diff, textconv, fsmonitor), must ignore a poisoned ambient
 * environment, and must fail closed without a session repository.
 *
 * Snapshots are compared path by path, so a regression reports the files it
 * touched. The fixture keeps the throwaway repositories free of git's own
 * background maintenance, which would otherwise race the comparison.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GIT_READONLY_DEFAULTS } from '../src/config.js';
import { createGitBlameTool } from '../src/tools/blame.js';
import { createGitContextTool } from '../src/tools/context.js';
import type { GitContextResult } from '../src/tools/context.js';
import { createGitHistoryTool } from '../src/tools/history.js';
import { createGitShowTool } from '../src/tools/show.js';
import type { GitShowResult } from '../src/tools/show.js';
import { silentPluginLogger } from '../src/logging.js';
import {
  createTempRepo,
  diffManifests,
  existsSync as fsExists,
  makeExec,
  normalizePath,
  repoManifest,
  type TempRepo,
} from './fixtures/git.js';

let repo: TempRepo;
let otherRepo: TempRepo;
let scratch: string;
let markerPath: string;
let helloOid: string;

beforeAll(async () => {
  repo = await createTempRepo();
  otherRepo = await createTempRepo();
  scratch = await mkdtemp(join(tmpdir(), 'dsh-git-readonly-mutation-'));
  markerPath = join(scratch, 'hostile-helper-marker');

  helloOid = await repo.commit('hello.txt', 'hello world\nsecond line\n', 'c1: add hello');
  await repo.commit('.gitattributes', '*.txt diff=qa\n', 'c2: gitattributes');

  // A helper that leaves a marker if git ever executes it. Written outside
  // the repository; wired through .git/config as external diff, textconv
  // driver and fsmonitor helper.
  const helper = join(scratch, 'marker-writer.mjs');
  await writeFile(
    helper,
    [
      'import { appendFileSync } from "node:fs";',
      'try { appendFileSync(process.argv[2], "pwned\\n"); } catch {}',
      '',
    ].join('\n'),
    'utf8',
  );
  const quote = (value: string) => `"${value.replaceAll('\\', '/')}"`;
  const hostileCommand = `${quote(process.execPath)} ${quote(helper)} ${quote(markerPath)}`;
  const config = await readFile(join(repo.dir, '.git', 'config'), 'utf8');
  await writeFile(
    join(repo.dir, '.git', 'config'),
    `${config}\n[diff]\n\texternal = ${hostileCommand}\n[diff "qa"]\n\ttextconv = ${hostileCommand}\n[core]\n\tfsmonitor = ${hostileCommand}\n`,
    'utf8',
  );
  await otherRepo.commit('elsewhere.txt', 'do not read\n', 'other repo commit');
});

afterAll(async () => {
  await repo.dispose();
  await otherRepo.dispose();
  await rm(scratch, { recursive: true, force: true });
});

function makeDeps() {
  return { config: GIT_READONLY_DEFAULTS, logger: silentPluginLogger() };
}

function makeTools() {
  return {
    context: createGitContextTool(makeDeps()),
    history: createGitHistoryTool(makeDeps()),
    show: createGitShowTool(makeDeps()),
    blame: createGitBlameTool(makeDeps()),
  };
}

const runAllTools = async () => {
  const tools = makeTools();
  const steps: [string, () => Promise<unknown>][] = [
    ['context', () => tools.context.execute({}, makeExec(repo.dir))],
    ['history', () => tools.history.execute({ query: 'hello', search: 'content' }, makeExec(repo.dir))],
    ['show', () => tools.show.execute({ oid: helloOid }, makeExec(repo.dir))],
    ['blame', () => tools.blame.execute({ file: 'hello.txt' }, makeExec(repo.dir))],
  ];
  for (const [label, call] of steps) {
    await call();
    if (existsSync(markerPath)) {
      throw new Error(`hostile helper executed during: ${label}`);
    }
  }
};

describe('read-only guarantee', () => {
  it('leaves the repository byte-identical across repeated tool calls', async () => {
    const before = await repoManifest(repo.dir);
    await runAllTools();
    await runAllTools();
    const after = await repoManifest(repo.dir);
    // An empty difference is byte-identity; anything else names the files that
    // moved, which two digests alone never did.
    expect(diffManifests(before, after)).toEqual([]);
  });

  it('snapshots a repository that schedules no background work', async () => {
    // `git commit` ends by spawning a detached `git maintenance run --auto`
    // that holds `.git/objects/maintenance.lock` until it exits. Left enabled
    // it outlives the commit on a loaded machine and drops that file into one
    // snapshot but not the other, failing the test above over a file no tool
    // wrote.
    expect((await repo.run(['config', '--get', 'maintenance.auto'])).trim()).toBe('false');
    expect((await repo.run(['config', '--get', 'gc.auto'])).trim()).toBe('0');
  });

  it('never executes repo-controlled diff, textconv or fsmonitor helpers', async () => {
    await runAllTools();
    expect(existsSync(markerPath)).toBe(false);
  });

  it('still produces correct output in the hostile repository', async () => {
    const tools = makeTools();
    const context = (await tools.context.execute({}, makeExec(repo.dir))) as GitContextResult;
    expect(normalizePath(context.root)).toBe(normalizePath(repo.dir));

    const shown = (await tools.show.execute({ oid: helloOid }, makeExec(repo.dir))) as GitShowResult;
    expect(shown.patch).toContain('diff --git');
    expect(shown.patch).toContain('hello world');
    expect(shown.files).toEqual([{ path: 'hello.txt', additions: 2, deletions: 0 }]);
  });
});

describe('ambient environment hardening', () => {
  it('ignores a poisoned GIT_DIR pointing at another repository', async () => {
    const previous = process.env['GIT_DIR'];
    process.env['GIT_DIR'] = join(otherRepo.dir, '.git');
    try {
      const tools = makeTools();
      const context = (await tools.context.execute({}, makeExec(repo.dir))) as GitContextResult;
      expect(normalizePath(context.root)).toBe(normalizePath(repo.dir));
    } finally {
      if (previous === undefined) delete process.env['GIT_DIR'];
      else process.env['GIT_DIR'] = previous;
    }
  });

  it('ignores poisoned diff and index redirection variables', async () => {
    const poisoned: Record<string, string> = {
      GIT_EXTERNAL_DIFF: join(otherRepo.dir, 'evil.sh'),
      GIT_INDEX_FILE: join(otherRepo.dir, '.git', 'index'),
      GIT_WORK_TREE: otherRepo.dir,
      GIT_OBJECT_DIRECTORY: join(otherRepo.dir, '.git', 'objects'),
    };
    const previous: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(poisoned)) {
      previous[key] = process.env[key];
      process.env[key] = value;
    }
    try {
      const tools = makeTools();
      const shown = (await tools.show.execute({ oid: helloOid }, makeExec(repo.dir))) as GitShowResult;
      expect(shown.patch).toContain('hello world');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe('snapshot diagnostics', () => {
  // The byte-identity assertion is only as strong as the difference it
  // reports: an empty list must mean "identical", never "not looking".
  it('names added, removed and changed files', () => {
    expect(diffManifests(new Map(), new Map())).toEqual([]);
    const before = new Map([
      ['keep.txt', 'a'],
      ['gone.txt', 'b'],
      ['edit.txt', 'c'],
    ]);
    const after = new Map([
      ['keep.txt', 'a'],
      ['edit.txt', 'd'],
      ['new.txt', 'e'],
    ]);
    expect(diffManifests(before, after)).toEqual([
      'changed edit.txt',
      'removed gone.txt',
      'added new.txt',
    ]);
  });

  it('sees a file written into .git by something other than a tool', async () => {
    const probe = join(repo.dir, '.git', 'snapshot-probe');
    const before = await repoManifest(repo.dir);
    await writeFile(probe, 'foreign\n', 'utf8');
    try {
      expect(diffManifests(before, await repoManifest(repo.dir))).toEqual([
        'added .git/snapshot-probe',
      ]);
    } finally {
      await rm(probe, { force: true });
    }
  });
});

describe('fail-closed boundaries', () => {
  it('rejects path traversal in every path argument', async () => {
    const tools = makeTools();
    await expect(
      tools.history.execute({ path: '../../outside' }, makeExec(repo.dir)),
    ).rejects.toThrowError(/invalid-path/);
    await expect(
      tools.show.execute({ oid: helloOid, path: 'a/../../b' }, makeExec(repo.dir)),
    ).rejects.toThrowError(/invalid-path/);
    await expect(
      tools.blame.execute({ file: '../secret.txt' }, makeExec(repo.dir)),
    ).rejects.toThrowError(/invalid-path/);
  });

  it('fails closed without a session cwd', async () => {
    const tools = makeTools();
    await expect(tools.context.execute({}, makeExec(undefined))).rejects.toThrowError(/no-session-cwd/);
    await expect(
      tools.history.execute({}, makeExec(undefined)),
    ).rejects.toThrowError(/no-session-cwd/);
  });

  it('fails closed outside a git repository', async () => {
    const tools = makeTools();
    await expect(
      tools.context.execute({}, makeExec(scratch)),
    ).rejects.toThrowError(/not-a-git-repository/);
  });

  it('keeps the hostile helper marker absent after all failures', () => {
    expect(fsExists(markerPath)).toBe(false);
  });
});
