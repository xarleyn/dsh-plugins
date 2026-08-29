import { describe, expect, it } from 'vitest';
import { DocImpactEngine } from '../src/engine/runtime.js';
import type { EngineOptions, EngineWorkspaceConfig } from '../src/engine/runtime.js';
import { normalizeConfig } from '../src/config/normalize.js';
import { buildReminderMessage, buildLimitMessage } from '../src/engine/reminder.js';
import type { ChangeDetector, DetectorOptions, FileChange, FileSnapshot, TurnBaseline } from '../src/index.js';

/** In-memory ChangeDetector over a mutable file universe. */
function fakeDetector(state: Map<string, string>): ChangeDetector {
  const snapshot = (): Map<string, FileSnapshot> => {
    const files = new Map<string, FileSnapshot>();
    for (const [path, content] of state) files.set(path, { exists: true, hash: content });
    return files;
  };
  return {
    kind: 'filesystem',
    async captureBaseline(cwd): Promise<TurnBaseline> {
      return { cwd, kind: 'filesystem', files: snapshot(), createdAt: Date.now(), degraded: false };
    },
    async computeChanges(_cwd: string, baseline: TurnBaseline) {
      const current = snapshot();
      const changes: FileChange[] = [];
      for (const path of new Set([...baseline.files.keys(), ...current.keys()])) {
        const before = baseline.files.get(path);
        const after = current.get(path);
        if (before === undefined && after !== undefined) changes.push({ path, type: 'added' });
        else if (before !== undefined && after === undefined) changes.push({ path, type: 'deleted' });
        else if (before !== undefined && after !== undefined && before.hash !== after.hash) {
          changes.push({ path, type: 'modified' });
        }
      }
      return { changes, degraded: false };
    },
    async listFiles() {
      return [...state.keys()].sort();
    },
  };
}

function workspace(rules: unknown, overrides: Partial<EngineWorkspaceConfig> = {}): EngineWorkspaceConfig {
  return {
    config: normalizeConfig({ version: 1, rules }),
    safety: { maxReminderRounds: 2, onLimit: 'allow' },
    maxSnapshotFiles: 1000,
    debug: false,
    ...overrides,
  };
}

const AUTH_RULE = [{
  id: 'auth',
  code: ['src/auth/**'],
  docs: ['docs/authentication.md'],
  direction: 'code-to-docs',
  mode: 'require-resolution',
}];

function engineWith(
  ws: EngineWorkspaceConfig,
  state: Map<string, string>,
  options: Partial<EngineOptions> = {},
): DocImpactEngine {
  const detector = fakeDetector(state);
  return new DocImpactEngine({
    configProvider: async () => ws,
    logger: { warn() {}, info() {}, error() {} },
    detectorFactory: () => detector,
    ...options,
  });
}

describe('doc impact engine', () => {
  it('steers for a pending impact and stops after explicit resolution', async () => {
    const state = new Map<string, string>([
      ['src/auth/session.ts', 'v1'],
      ['docs/authentication.md', 'd1'],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);

    await engine.ensureBaseline('a1', '/virtual', 1);
    state.set('src/auth/session.ts', 'v2');

    const first = await engine.evaluateStop('a1', '/virtual', 1);
    expect(first.steer).toContain('Documentation impact check');
    expect(first.steer).toContain('doc_impact_resolve');
    expect(first.pending).toHaveLength(1);

    // Strict mode keeps reminding while unresolved.
    const second = await engine.evaluateStop('a1', '/virtual', 1);
    expect(second.steer).toBeDefined();

    const outcome = await engine.resolve('a1', '/virtual', 1, {
      ruleId: 'auth',
      status: 'reviewed-current',
    });
    expect(outcome.resolved).toBe(1);
    expect(outcome.remaining).toHaveLength(0);

    const third = await engine.evaluateStop('a1', '/virtual', 1);
    expect(third.steer).toBeUndefined();
  });

  it('auto-resolves when the impacted target changes (SPEC §31)', async () => {
    const state = new Map<string, string>([
      ['src/auth/session.ts', 'v1'],
      ['docs/authentication.md', 'd1'],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);
    await engine.ensureBaseline('a1', '/virtual', 1);
    state.set('src/auth/session.ts', 'v2');

    const first = await engine.evaluateStop('a1', '/virtual', 1);
    expect(first.steer).toBeDefined();

    // The agent updates the documentation in the steered step.
    state.set('docs/authentication.md', 'd2');
    const second = await engine.evaluateStop('a1', '/virtual', 1);
    expect(second.steer).toBeUndefined();
    expect(second.pending).toHaveLength(0);
  });

  it('treats code+docs changed together as already satisfied (SPEC §88)', async () => {
    const state = new Map<string, string>([
      ['src/auth/session.ts', 'v1'],
      ['docs/authentication.md', 'd1'],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);
    await engine.ensureBaseline('a1', '/virtual', 1);
    state.set('src/auth/session.ts', 'v2');
    state.set('docs/authentication.md', 'd2');
    const decision = await engine.evaluateStop('a1', '/virtual', 1);
    expect(decision.steer).toBeUndefined();
    expect(decision.pending).toHaveLength(0);
  });

  it('reminds only once per fingerprint in remind mode', async () => {
    const state = new Map<string, string>([
      ['src/auth/session.ts', 'v1'],
      ['docs/authentication.md', 'd1'],
    ]);
    const ws = workspace([
      { id: 'auth-remind', code: ['src/auth/**'], docs: ['docs/authentication.md'], direction: 'code-to-docs', mode: 'remind' },
    ]);
    const engine = engineWith(ws, state);
    await engine.ensureBaseline('a1', '/virtual', 1);
    state.set('src/auth/session.ts', 'v2');

    const first = await engine.evaluateStop('a1', '/virtual', 1);
    expect(first.steer).toBeDefined();
    const second = await engine.evaluateStop('a1', '/virtual', 1);
    expect(second.steer).toBeUndefined();
    expect(second.pending).toHaveLength(1);
  });

  it('stops steering after maxReminderRounds (fail-open, SPEC §34)', async () => {
    const state = new Map<string, string>([
      ['src/auth/session.ts', 'v1'],
      ['docs/authentication.md', 'd1'],
    ]);
    const ws = workspace(AUTH_RULE, { safety: { maxReminderRounds: 2, onLimit: 'allow' } });
    const engine = engineWith(ws, state);
    await engine.ensureBaseline('a1', '/virtual', 1);
    state.set('src/auth/session.ts', 'v2');

    expect((await engine.evaluateStop('a1', '/virtual', 1)).steer).toBeDefined();
    expect((await engine.evaluateStop('a1', '/virtual', 1)).steer).toBeDefined();
    expect((await engine.evaluateStop('a1', '/virtual', 1)).steer).toBeUndefined();
  });

  it('errors loudly once at the limit when onLimit is error', async () => {
    const state = new Map<string, string>([
      ['src/auth/session.ts', 'v1'],
      ['docs/authentication.md', 'd1'],
    ]);
    const logged: string[] = [];
    const ws = workspace(AUTH_RULE, { safety: { maxReminderRounds: 1, onLimit: 'error' } });
    const engine = engineWith(ws, state, {
      logger: { warn() {}, info() {}, error: (message) => logged.push(message) },
    });
    await engine.ensureBaseline('a1', '/virtual', 1);
    state.set('src/auth/session.ts', 'v2');

    expect((await engine.evaluateStop('a1', '/virtual', 1)).steer).toBeDefined();
    const limited = await engine.evaluateStop('a1', '/virtual', 1);
    expect(limited.steer).toContain('reminder limit reached');
    // The final notice fires once, not on every subsequent stop.
    const again = await engine.evaluateStop('a1', '/virtual', 1);
    expect(again.steer).toBeUndefined();
    expect(logged).toHaveLength(1);
  });

  it('rejects updated-resolution when the target did not change', async () => {
    const state = new Map<string, string>([
      ['src/auth/session.ts', 'v1'],
      ['docs/authentication.md', 'd1'],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);
    await engine.ensureBaseline('a1', '/virtual', 1);
    state.set('src/auth/session.ts', 'v2');
    await engine.evaluateStop('a1', '/virtual', 1);

    await expect(
      engine.resolve('a1', '/virtual', 1, { ruleId: 'auth', status: 'updated' }),
    ).rejects.toThrow('updated resolution requires a changed target file');
  });

  it('rejects not-applicable without a reason', async () => {
    const state = new Map<string, string>([
      ['src/auth/session.ts', 'v1'],
      ['docs/authentication.md', 'd1'],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);
    await engine.ensureBaseline('a1', '/virtual', 1);
    state.set('src/auth/session.ts', 'v2');
    await engine.evaluateStop('a1', '/virtual', 1);

    await expect(
      engine.resolve('a1', '/virtual', 1, { ruleId: 'auth', status: 'not-applicable' }),
    ).rejects.toThrow('non-empty reason');
  });

  it('fails open when the config is missing', async () => {
    const engine = new DocImpactEngine({ configProvider: async () => undefined });
    await engine.ensureBaseline('a2', '/nowhere', 1);
    const decision = await engine.evaluateStop('a2', '/nowhere', 1);
    expect(decision.steer).toBeUndefined();
    expect(decision.pending).toHaveLength(0);
  });

  it('keeps separate runtimes per turn (turn scope)', async () => {
    const state = new Map<string, string>([
      ['src/auth/session.ts', 'v1'],
      ['docs/authentication.md', 'd1'],
    ]);
    const engine = engineWith(workspace(AUTH_RULE), state);
    await engine.ensureBaseline('a1', '/virtual', 1);
    state.set('src/auth/session.ts', 'v2');
    expect((await engine.evaluateStop('a1', '/virtual', 1)).steer).toBeDefined();
    engine.disposeTurn('a1', 1);

    // Turn 2: fresh baseline → the (already committed) change is invisible.
    await engine.ensureBaseline('a1', '/virtual', 2);
    const next = await engine.evaluateStop('a1', '/virtual', 2);
    expect(next.steer).toBeUndefined();
    expect(next.changed).toHaveLength(0);
  });
});

describe('reminder messages', () => {
  it('mentions missing documentation targets and groups rules', () => {
    const message = buildReminderMessage(
      [
        {
          id: 'fp1',
          ruleId: 'auth',
          direction: 'code-to-docs',
          triggerSide: 'code',
          targetSide: 'docs',
          triggerFiles: ['src/auth/session.ts'],
          targetFiles: ['docs/authentication.md', 'docs/missing.md'],
          relation: 'documents',
          mode: 'require-resolution',
          status: 'pending',
          detectedAt: 0,
        },
      ],
      new Set(['src/auth/session.ts', 'docs/authentication.md']),
      'own',
    );
    expect(message).toContain('1 rule');
    expect(message).toContain('does not exist: docs/missing.md');
    expect(message).toContain('reviewed-current');
  });

  it('flags uncertain attribution for concurrent agents (SPEC §49)', () => {
    const message = buildReminderMessage(
      [
        {
          id: 'fp1',
          ruleId: 'auth',
          direction: 'code-to-docs',
          triggerSide: 'code',
          targetSide: 'docs',
          triggerFiles: ['src/auth/session.ts'],
          targetFiles: ['docs/authentication.md'],
          relation: 'documents',
          mode: 'remind',
          status: 'pending',
          detectedAt: 0,
        },
      ],
      new Set(['docs/authentication.md']),
      'uncertain',
    );
    expect(message).toContain('changed while this agent was active');
  });

  it('renders the limit notice with rule ids', () => {
    const message = buildLimitMessage(
      [
        {
          id: 'fp1',
          ruleId: 'auth',
          direction: 'code-to-docs',
          triggerSide: 'code',
          targetSide: 'docs',
          triggerFiles: ['src/auth/session.ts'],
          targetFiles: ['docs/authentication.md'],
          relation: 'documents',
          mode: 'require-resolution',
          status: 'pending',
          detectedAt: 0,
        },
      ],
      2,
    );
    expect(message).toContain('auth');
    expect(message).toContain('docs/authentication.md');
    expect(message).toContain('2 reminder round(s)');
  });
});

describe('detector options', () => {
  it('accepts the enforced selector shape', () => {
    const options: DetectorOptions = {
      selectors: [{ include: ['src/**'], exclude: ['**/*.test.ts'] }],
      maxFiles: 10_000,
    };
    expect(options.selectors[0]!.include).toEqual(['src/**']);
  });
});
