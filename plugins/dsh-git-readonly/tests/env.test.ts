/** Unit tests for the git environment hardening (SPEC §6.2). */

import { describe, expect, it } from 'vitest';

import { buildGitEnv, FORCED_ENV_VALUES, REMOVED_ENV_KEYS } from '../src/git/env.js';

describe('buildGitEnv', () => {
  it('removes every ambient git redirection key', () => {
    const base: NodeJS.ProcessEnv = {};
    for (const key of REMOVED_ENV_KEYS) base[key] = `poisoned-${key}`;
    base['PATH'] = '/usr/bin';
    const env = buildGitEnv(base);
    for (const key of REMOVED_ENV_KEYS) {
      if (key in FORCED_ENV_VALUES) continue;
      expect(env[key], key).toBeUndefined();
    }
    // GIT_PAGER is both removed (ambient) and forced (deterministic paging).
    expect(env['GIT_PAGER']).toBe('cat');
    expect(env['PATH']).toBe('/usr/bin');
  });

  it('forces deterministic, lock-free, unpaged values', () => {
    const env = buildGitEnv({ LC_ALL: 'ru_RU.UTF-8', GIT_PAGER: 'less' });
    for (const [key, value] of Object.entries(FORCED_ENV_VALUES)) {
      expect(env[key], key).toBe(value);
    }
  });

  it('keeps unrelated ambient variables intact', () => {
    const env = buildGitEnv({ HOME: '/home/qa', SYSTEMROOT: 'C:/Windows' });
    expect(env['HOME']).toBe('/home/qa');
    expect(env['SYSTEMROOT']).toBe('C:/Windows');
  });
});
