import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGitDetector } from '../src/changes/git-detector.js';
import type { DetectorOptions } from '../src/changes/types.js';

const run = promisify(execFile);

const selectors: DetectorOptions['selectors'] = [
  { include: ['src/**'], exclude: [] },
  { include: ['docs/authentication.md'], exclude: [] },
];
const options: DetectorOptions = { selectors, maxFiles: 1000 };

async function git(cwd: string, ...args: string[]): Promise<void> {
  await run('git', args, { cwd });
}

async function initRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-doc-impact-'));
  await git(cwd, 'init', '-b', 'main');
  await git(cwd, 'config', 'user.email', 'test@example.com');
  await git(cwd, 'config', 'user.name', 'Doc Impact Tests');
  return cwd;
}

async function commitAll(cwd: string, message: string): Promise<void> {
  await git(cwd, 'add', '-A');
  await git(cwd, 'commit', '-m', message, '--no-gpg-sign');
}

function changed(detector: ReturnType<typeof createGitDetector>, cwd: string, baseline: Awaited<ReturnType<typeof detector.captureBaseline>>) {
  return detector.computeChanges(cwd, baseline);
}

function paths(diff: { changes: { path: string; type: string }[] }): Map<string, string> {
  return new Map(diff.changes.map((change) => [change.path, change.type]));
}

const repos: string[] = [];

afterAll(async () => {
  await Promise.all(repos.map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('git baseline detector', () => {
  it('detects agent modifications in a clean workspace', async () => {
    const cwd = await initRepo();
    repos.push(cwd);
    await mkdir(join(cwd, 'src'), { recursive: true });
    await writeFile(join(cwd, 'src', 'session.ts'), 'export {};\n');
    await commitAll(cwd, 'init');

    const detector = createGitDetector(options);
    const baseline = await detector.captureBaseline(cwd);
    expect(baseline.files.size).toBe(0);

    await mkdir(join(cwd, 'docs'), { recursive: true });
    await writeFile(join(cwd, 'docs', 'unrelated.md'), 'unrelated\n');
    await writeFile(join(cwd, 'src', 'session.ts'), 'export const changed = true;\n');
    const diff = await changed(detector, cwd, baseline);
    expect([...paths(diff).entries()].sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ['docs/unrelated.md', 'added'],
      ['src/session.ts', 'modified'],
    ]);
  });

  it('does not attribute pre-existing user changes to the agent', async () => {
    const cwd = await initRepo();
    repos.push(cwd);
    await mkdir(join(cwd, 'src'), { recursive: true });
    await writeFile(join(cwd, 'src', 'session.ts'), 'user edit before turn\n');
    await commitAll(cwd, 'init');
    // The user dirties the file BEFORE the agent's turn starts.
    await writeFile(join(cwd, 'src', 'session.ts'), 'user edit before turn (dirty)\n');

    const detector = createGitDetector(options);
    const baseline = await detector.captureBaseline(cwd);
    expect(baseline.files.has('src/session.ts')).toBe(true);

    // Agent touches nothing.
    const diff = await changed(detector, cwd, baseline);
    expect(diff.changes).toEqual([]);
  });

  it('detects further edits to an already-dirty file', async () => {
    const cwd = await initRepo();
    repos.push(cwd);
    await mkdir(join(cwd, 'src'), { recursive: true });
    await writeFile(join(cwd, 'src', 'session.ts'), 'base\n');
    await commitAll(cwd, 'init');
    await writeFile(join(cwd, 'src', 'session.ts'), 'user edit\n');

    const detector = createGitDetector(options);
    const baseline = await detector.captureBaseline(cwd);
    await writeFile(join(cwd, 'src', 'session.ts'), 'user edit + agent edit\n');
    const diff = await changed(detector, cwd, baseline);
    expect(paths(diff)).toEqual(new Map([['src/session.ts', 'modified']]));
  });

  it('detects created and deleted files', async () => {
    const cwd = await initRepo();
    repos.push(cwd);
    await mkdir(join(cwd, 'src'), { recursive: true });
    await writeFile(join(cwd, 'src', 'old.ts'), 'old\n');
    await commitAll(cwd, 'init');

    const detector = createGitDetector(options);
    const baseline = await detector.captureBaseline(cwd);

    await writeFile(join(cwd, 'src', 'new.ts'), 'new\n');
    await unlink(join(cwd, 'src', 'old.ts'));
    const diff = await changed(detector, cwd, baseline);
    expect(paths(diff)).toEqual(
      new Map([
        ['src/new.ts', 'added'],
        ['src/old.ts', 'deleted'],
      ]),
    );
  });

  it('restoring original content cancels the impact', async () => {
    const cwd = await initRepo();
    repos.push(cwd);
    await mkdir(join(cwd, 'src'), { recursive: true });
    await writeFile(join(cwd, 'src', 'session.ts'), 'original\n');
    await commitAll(cwd, 'init');

    const detector = createGitDetector(options);
    const baseline = await detector.captureBaseline(cwd);

    await writeFile(join(cwd, 'src', 'session.ts'), 'changed then restored\n');
    await writeFile(join(cwd, 'src', 'session.ts'), 'original\n');
    const diff = await changed(detector, cwd, baseline);
    expect(diff.changes).toEqual([]);
  });

  it('detects changes the agent committed during the turn', async () => {
    const cwd = await initRepo();
    repos.push(cwd);
    await mkdir(join(cwd, 'src'), { recursive: true });
    await writeFile(join(cwd, 'src', 'session.ts'), 'committed later\n');
    await commitAll(cwd, 'init');

    const detector = createGitDetector(options);
    const baseline = await detector.captureBaseline(cwd);

    await writeFile(join(cwd, 'src', 'session.ts'), 'committed work\n');
    await commitAll(cwd, 'agent commits');

    const diff = await changed(detector, cwd, baseline);
    expect(paths(diff)).toEqual(new Map([['src/session.ts', 'modified']]));
  });

  it('records both paths of a committed rename', async () => {
    const cwd = await initRepo();
    repos.push(cwd);
    await mkdir(join(cwd, 'src'), { recursive: true });
    await writeFile(join(cwd, 'src', 'old-name.ts'), 'content\n');
    await commitAll(cwd, 'init');

    const detector = createGitDetector(options);
    const baseline = await detector.captureBaseline(cwd);

    await git(cwd, 'mv', 'src/old-name.ts', 'src/new-name.ts');
    await commitAll(cwd, 'rename');

    const diff = await changed(detector, cwd, baseline);
    const detected = paths(diff);
    expect(detected.get('src/new-name.ts')).toBeDefined();
    expect(detected.get('src/old-name.ts')).toBeDefined();
  });

  it('falls back to filesystem enumeration when git is absent', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'dsh-doc-impact-fs-'));
    repos.push(plain);
    const { createFilesystemDetector } = await import('../src/changes/filesystem-detector.js');
    const detector = createFilesystemDetector(options);

    await mkdir(join(plain, 'src'), { recursive: true });
    await writeFile(join(plain, 'src', 'a.ts'), 'one\n');
    const baseline = await detector.captureBaseline(plain);

    await writeFile(join(plain, 'src', 'a.ts'), 'two\n');
    await writeFile(join(plain, 'src', 'b.ts'), 'new\n');
    const diff = await detector.computeChanges(plain, baseline);
    expect(new Set(diff.changes.map((change) => change.path))).toEqual(
      new Set(['src/a.ts', 'src/b.ts']),
    );
    expect(await detector.listFiles(plain).then((files) => files.sort())).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });
});
