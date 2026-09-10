/** Unit tests for config resolution and clamping (SPEC §10). */

import { describe, expect, it } from 'vitest';

import {
  GIT_READONLY_DEFAULTS,
  GitReadonlyConfigSchema,
  resolveGitReadonlyConfig,
} from '../src/config.js';

describe('resolveGitReadonlyConfig', () => {
  it('returns safe defaults for empty input', () => {
    expect(resolveGitReadonlyConfig(undefined)).toEqual(GIT_READONLY_DEFAULTS);
    expect(resolveGitReadonlyConfig({})).toEqual(GIT_READONLY_DEFAULTS);
  });

  it('clamps limits into the safe corridor', () => {
    const resolved = resolveGitReadonlyConfig({
      timeoutMs: 1,
      history: { defaultLimit: 0, maxLimit: 100_000 },
      blame: { maxLines: -5 },
      patchBytes: 10 ** 9,
    });
    expect(resolved.timeoutMs).toBe(1_000);
    expect(resolved.historyDefaultLimit).toBe(1);
    expect(resolved.historyMaxLimit).toBe(200);
    expect(resolved.blameMaxLines).toBe(1);
    expect(resolved.patchBytes).toBe(1_048_576);
  });

  it('floors fractional numbers and falls back on garbage', () => {
    const resolved = resolveGitReadonlyConfig({
      timeoutMs: 2_500.9,
      gitPath: '  ',
    });
    expect(resolved.timeoutMs).toBe(2_500);
    expect(resolved.gitPath).toBe(GIT_READONLY_DEFAULTS.gitPath);
  });

  it('honours in-range configuration', () => {
    const resolved = resolveGitReadonlyConfig({
      enabled: false,
      gitPath: 'C:/Program Files/Git/bin/git.exe',
      timeoutMs: 20_000,
      history: { defaultLimit: 10, maxLimit: 50 },
      blame: { maxLines: 50 },
      patchBytes: 65_536,
    });
    expect(resolved.enabled).toBe(false);
    expect(resolved.gitPath).toBe('C:/Program Files/Git/bin/git.exe');
    expect(resolved.historyDefaultLimit).toBe(10);
    expect(resolved.historyMaxLimit).toBe(50);
    expect(resolved.blameMaxLines).toBe(50);
    expect(resolved.patchBytes).toBe(65_536);
  });
});

describe('GitReadonlyConfigSchema', () => {
  it('exposes the same defaults through the Schemastery contract', () => {
    const resolved = GitReadonlyConfigSchema({});
    expect(resolveGitReadonlyConfig(resolved)).toEqual(GIT_READONLY_DEFAULTS);
  });
});
