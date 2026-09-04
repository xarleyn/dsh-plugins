import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPluginLogger, getPluginLogger } from '@yadsh/dsh-plugin-log';
import { createEngineFileLogger } from '../src/dsh/engine-logger.js';

async function makeLogDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-doc-impact-logs-'));
}

async function readLogLines(dir: string): Promise<Record<string, unknown>[]> {
  const lines: Record<string, unknown>[] = [];
  for (const entry of await readdir(dir)) {
    const text = await readFile(join(dir, entry), 'utf8');
    for (const line of text.split('\n')) {
      if (line.trim() !== '') lines.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return lines;
}

describe('plugin-logger package integration', () => {
  let directories: string[] = [];
  let savedDisabled: string | undefined;

  beforeEach(() => {
    savedDisabled = process.env.DSH_LOG_DISABLED;
  });

  afterEach(async () => {
    if (savedDisabled === undefined) delete process.env.DSH_LOG_DISABLED;
    else process.env.DSH_LOG_DISABLED = savedDisabled;
    const pending = directories;
    directories = [];
    await Promise.all(pending.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function newDir(): Promise<string> {
    const dir = await makeLogDir();
    directories.push(dir);
    return dir;
  }

  it('writes NDJSON records with plugin, level, time and event', async () => {
    const dir = await newDir();
    const logger = createPluginLogger({ pluginId: 'dsh-doc-impact-test', dir, level: 'info', console: 'silent' });
    logger.info('dsh-doc-impact: active', { workspace: 'w1' });
    await logger.close();

    const lines = await readLogLines(dir);
    expect(lines).toHaveLength(1);
    const record = lines[0] as Record<string, unknown>;
    expect(record['plugin']).toBe('dsh-doc-impact-test');
    expect(record['msg']).toBe('dsh-doc-impact: active');
    expect(record['workspace']).toBe('w1');
    expect(record['level']).toBe(30);
    expect(typeof record['time']).toBe('number');
  });

  it('drops records below the configured level', async () => {
    const dir = await newDir();
    const logger = createPluginLogger({ pluginId: 'dsh-doc-impact-test', dir, level: 'error', console: 'silent' });
    logger.info('dsh-doc-impact: dropped');
    expect(await readdir(dir)).toEqual([]);
    logger.error('dsh-doc-impact: kept');
    await logger.close();

    const lines = await readLogLines(dir);
    expect(lines.map((line) => line['msg'])).toEqual(['dsh-doc-impact: kept']);
  });

  it('adds a module field through child()', async () => {
    const dir = await newDir();
    const logger = createPluginLogger({ pluginId: 'dsh-doc-impact-test', dir, level: 'info', console: 'silent' });
    logger.child('config').warn('dsh-doc-impact: malformed overrides');
    await logger.close();

    const lines = await readLogLines(dir);
    expect(lines[0]?.['module']).toBe('config');
    expect(lines[0]?.['msg']).toBe('dsh-doc-impact: malformed overrides');
  });

  it('rolls over to a new file when the day changes', async () => {
    const dir = await newDir();
    let now = new Date(2026, 0, 15, 12, 0, 0).getTime();
    const logger = createPluginLogger({
      pluginId: 'dsh-doc-impact-test',
      dir,
      level: 'info',
      console: 'silent',
      now: () => now,
    });
    logger.info('day one');
    now += 86_400_000;
    logger.info('day two');
    await logger.close();

    expect(await readdir(dir)).toHaveLength(2);
    const lines = await readLogLines(dir);
    expect(lines.map((line) => line['msg'])).toEqual(['day one', 'day two']);
  });

  it('removes daily files older than the retention window on rollover', async () => {
    const dir = await newDir();
    await writeFile(join(dir, '2020-01-01.log'), '{"msg":"ancient"}\n', 'utf8');
    await writeFile(join(dir, '2026-01-10.log'), '{"msg":"recent"}\n', 'utf8');
    const logger = createPluginLogger({
      pluginId: 'dsh-doc-impact-test',
      dir,
      level: 'info',
      console: 'silent',
      retentionDays: 14,
      now: () => new Date(2026, 0, 15, 12, 0, 0).getTime(),
    });
    logger.info('current');
    await logger.close();

    const entries = await readdir(dir);
    expect(entries).not.toContain('2020-01-01.log');
    expect(entries).toContain('2026-01-10.log');
  });

  it('degrades to console-only when the log dir cannot be created', async () => {
    const dir = await newDir();
    const blocker = join(dir, 'not-a-dir');
    await writeFile(blocker, 'occupied', 'utf8');
    const mirrored: string[] = [];
    const logger = createPluginLogger({
      pluginId: 'dsh-doc-impact-test',
      dir: blocker,
      level: 'info',
      consoleSink: (level, message) => mirrored.push(`${level}:${message}`),
    });
    expect(() => logger.info('still safe')).not.toThrow();
    await logger.close();
    expect(mirrored.some((line) => line.startsWith('warn:[dsh-doc-impact-test] logging.file_disabled'))).toBe(true);
  });

  it('disables file output when DSH_LOG_DISABLED=1', async () => {
    const dir = await newDir();
    process.env.DSH_LOG_DISABLED = '1';
    const logger = createPluginLogger({ pluginId: 'dsh-doc-impact-test', dir, level: 'info', console: 'silent' });
    logger.info('no file');
    await logger.close();
    expect(await readdir(dir)).toEqual([]);
  });

  it('caches instances per plugin id and dir until close', async () => {
    const dir = await newDir();
    const options = (level?: 'info' | 'error') => ({
      pluginId: 'dsh-doc-impact-cached',
      dir,
      ...(level === undefined ? {} : { level }),
      console: 'silent' as const,
    });
    const first = getPluginLogger(options('info'));
    expect(getPluginLogger(options('info'))).toBe(first);
    expect(getPluginLogger(options('error')).level).toBe('error');
    await first.close();
    const second = getPluginLogger(options('info'));
    expect(second).not.toBe(first);
    await second.close();
  });
});

describe('createEngineFileLogger', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await makeLogDir();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes engine messages to the plugin log file and mirrors to the host logger', async () => {
    const mirrored: { level: string; message: string }[] = [];
    const host = {
      info: (message: string) => mirrored.push({ level: 'info', message }),
      warn: (message: string) => mirrored.push({ level: 'warn', message }),
      error: (message: string) => mirrored.push({ level: 'error', message }),
    };
    const logger = createEngineFileLogger(host, { dir: directory });
    logger.info('baseline captured for s1 turn 1');
    logger.warn('workspace config rejected');
    await logger.close();

    const lines = await readLogLines(directory);
    // The plugin name appears exactly once per record: the logger's own scope
    // tag. Message text never repeats it.
    expect(lines.map((line) => line['msg'])).toEqual([
      'baseline captured for s1 turn 1',
      'workspace config rejected',
    ]);
    expect(mirrored).toEqual([
      { level: 'info', message: '[dsh-doc-impact] baseline captured for s1 turn 1' },
      { level: 'warn', message: '[dsh-doc-impact] workspace config rejected' },
    ]);
  });

  it('keeps mirroring when the destination is unavailable', async () => {
    const blocker = join(directory, 'not-a-dir');
    await writeFile(blocker, 'occupied', 'utf8');
    const mirrored: string[] = [];
    const logger = createEngineFileLogger(
      {
        info: (message) => mirrored.push(`info:${message}`),
        warn: (message) => mirrored.push(`warn:${message}`),
        error: (message) => mirrored.push(`error:${message}`),
      },
      { dir: blocker },
    );
    expect(() => logger.warn('still safe')).not.toThrow();
    await logger.close();
    expect(mirrored).toContain('warn:[dsh-doc-impact] still safe');
  });
});
