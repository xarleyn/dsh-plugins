import { describe, expect, it } from 'vitest';
import {
  autoResolveImpact,
  createImpactFingerprint,
  ImpactState,
  resolveImpact,
  type Impact,
} from '../src/index.js';

function pendingImpact(overrides: Partial<Impact> = {}): Impact {
  return {
    id: 'fingerprint',
    ruleId: 'auth',
    direction: 'code-to-docs',
    triggerSide: 'code',
    targetSide: 'docs',
    triggerFiles: ['src/auth.ts'],
    targetFiles: ['docs/auth.md'],
    relation: 'documents',
    mode: 'require-resolution',
    status: 'pending',
    detectedAt: 1,
    ...overrides,
  };
}

describe('fingerprints and resolution', () => {
  it('creates stable order-independent fingerprints', () => {
    const first = createImpactFingerprint('auth', ['b.ts', 'a.ts'], ['z.md', 'x.md']);
    const second = createImpactFingerprint('auth', ['a.ts', 'b.ts'], ['x.md', 'z.md']);
    const changed = createImpactFingerprint('auth', ['a.ts'], ['x.md', 'z.md']);
    expect(first).toBe(second);
    expect(changed).not.toBe(first);
  });

  it('automatically resolves a changed target', () => {
    expect(autoResolveImpact(pendingImpact(), ['docs\\auth.md']).status).toBe('updated');
    expect(autoResolveImpact(pendingImpact(), ['src/auth.ts']).status).toBe('pending');
  });

  it('validates explicit resolutions', () => {
    expect(resolveImpact(
      pendingImpact(),
      { ruleId: 'auth', status: 'reviewed-current' },
      [],
    ).status).toBe('reviewed-current');

    expect(() => resolveImpact(
      pendingImpact(),
      { ruleId: 'auth', status: 'updated' },
      [],
    )).toThrow('updated resolution requires a changed target file');

    expect(() => resolveImpact(
      pendingImpact(),
      { ruleId: 'auth', status: 'not-applicable' },
      [],
    )).toThrow('not-applicable resolution requires a non-empty reason');

    expect(resolveImpact(
      pendingImpact(),
      { ruleId: 'auth', status: 'not-applicable', reason: 'Purely internal refactor' },
      [],
    )).toMatchObject({ status: 'not-applicable', reason: 'Purely internal refactor' });
  });
});

describe('reminder state', () => {
  it('reminds once in remind mode', () => {
    const state = new ImpactState();
    const impact = pendingImpact({ mode: 'remind' });
    expect(state.shouldRemind(impact)).toBe(true);
    state.recordReminder(impact);
    expect(state.shouldRemind(impact)).toBe(false);
  });

  it('bounds strict reminder loops', () => {
    const state = new ImpactState({ maxReminderRounds: 2 });
    const impact = pendingImpact();
    state.recordReminder(impact);
    expect(state.shouldRemind(impact)).toBe(true);
    state.recordReminder(impact);
    expect(state.shouldRemind(impact)).toBe(false);
  });

  it('supersedes an old pending fingerprint when a rule changes shape', () => {
    const state = new ImpactState();
    const oldImpact = pendingImpact({ id: 'old' });
    const nextImpact = pendingImpact({ id: 'new', triggerFiles: ['src/auth-v2.ts'] });
    state.reconcile([oldImpact]);
    state.reconcile([nextImpact]);
    expect(state.pending()).toEqual([nextImpact]);
  });
});
