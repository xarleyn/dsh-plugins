import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DocImpactEngine } from '../src/engine/runtime.js';
import { createWorkspaceConfigSource } from '../src/dsh/config-source.js';
import { resolvePluginConfig } from '../src/dsh/plugin-config.js';
import { registerLifecycle } from '../src/dsh/lifecycle.js';
import { createDocImpactCommand } from '../src/dsh/commands.js';
import type { ImpactRule } from '../src/index.js';

const run = promisify(execFile);

const CONFIG_YAML = `version: 1

rules:
  - id: auth
    code:
      - src/auth/**
    docs:
      - docs/authentication.md
    direction: code-to-docs
    mode: require-resolution
`;

interface Harness {
  cwd: string;
  engine: DocImpactEngine;
  steerCalls: string[];
  /** Simulate the agent's stop through the registered turn-stopping listener. */
  stop(): Promise<string | undefined>;
  preStep(): Promise<void>;
  command(raw: string): Promise<{ kind: 'success' | 'error'; text: string }>;
}

const cleanups: (() => Promise<void>)[] = [];

async function makeRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-doc-impact-e2e-'));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  await run('git', ['init', '-b', 'main'], { cwd });
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd });
  await run('git', ['config', 'user.name', 'Doc Impact Tests'], { cwd });
  await mkdir(join(cwd, 'src', 'auth'), { recursive: true });
  await mkdir(join(cwd, 'docs'), { recursive: true });
  await mkdir(join(cwd, '.dsh'), { recursive: true });
  await writeFile(join(cwd, 'src', 'auth', 'session.ts'), 'export const session = 1;\n');
  await writeFile(join(cwd, 'docs', 'authentication.md'), '# Authentication\n\nSessions live for 24h.\n');
  await writeFile(join(cwd, '.dsh', 'doc-impact.yml'), CONFIG_YAML);
  await run('git', ['add', '-A'], { cwd });
  await run('git', ['commit', '-m', 'init', '--no-gpg-sign'], { cwd });
  return cwd;
}

async function makeHarness(userDirtyDoc = false): Promise<Harness> {
  const cwd = await makeRepo();
  const source = createWorkspaceConfigSource(() => resolvePluginConfig(undefined));

  const engine = new DocImpactEngine({
    configProvider: (path) => source(path),
    logger: { warn() {}, info() {}, error() {} },
  });

  const steerCalls: string[] = [];
  const agent = {
    id: 'e2e-agent',
    session: {
      id: 'e2e-agent',
      header: { cwd },
      events: [] as { type: string; data: unknown }[],
    },
    steer(message: unknown) {
      steerCalls.push(JSON.stringify(message));
    },
  };

  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  const ctx = {
    on(event: string, listener: (...args: never[]) => unknown) {
      listeners.set(event, listener as (...args: unknown[]) => unknown);
      return undefined;
    },
    logger: {
      info() {}, warn() {}, error() {},
    },
  };
  registerLifecycle(ctx as never, engine);

  // The session log starts with one open turn, as the loop appends turn/start
  // before any step work.
  agent.session.events.push({ type: 'turn/start', data: { turn: 1 } });

  return {
    cwd,
    engine,
    steerCalls,
    async preStep() {
      const listener = listeners.get('agent/pre-step');
      await listener?.({ agent, turn: 1, step: 1, signal: undefined }, async () => ({}));
    },
    async stop() {
      const listener = listeners.get('agent/turn-stopping');
      const before = steerCalls.length;
      await listener?.({ agent, turn: 1, signal: undefined });
      return steerCalls.length > before ? steerCalls.at(-1) : undefined;
    },
    async command(raw: string) {
      const command = createDocImpactCommand(engine, {
        rulesFor: async () => (await source(cwd))?.config.rules ?? ([] as ImpactRule[]),
      });
      return command.handler({ agent, rawInput: raw });
    },
    ...(userDirtyDoc ? { cwd } : {}),
  };
}

describe('end-to-end: Definition of Done scenario (SPEC §95)', () => {
  it('detects the agent change, steers, resolves, and closes', async () => {
    const harness = await makeHarness();

    // Baseline exists before any mutation (pre-step gating).
    await harness.preStep();

    // The agent edits the implementation only.
    await writeFile(join(harness.cwd, 'src', 'auth', 'session.ts'), 'export const session = 2;\n');

    const steered = await harness.stop();
    expect(steered).toBeDefined();
    expect(steered).toContain('Documentation impact check');
    expect(steered).toContain('docs/authentication.md');

    // The agent reviews the doc, confirms it is current.
    const outcome = await harness.engine.resolve('e2e-agent', harness.cwd, 1, {
      ruleId: 'auth',
      status: 'reviewed-current',
    });
    expect(outcome.remaining).toHaveLength(0);

    // Turn closes without another reminder.
    expect(await harness.stop()).toBeUndefined();
  });

  it('does not attribute pre-existing user changes to the agent', async () => {
    const harness = await makeHarness();
    await harness.preStep();

    // The user had already dirtied the documentation before the turn.
    await appendFile(join(harness.cwd, 'docs', 'authentication.md'), 'User note.\n');
    // Re-capture would not happen in reality; instead start a fresh harness
    // where the dirty state exists BEFORE the baseline. We emulate that by
    // disposing the turn and re-capturing after the user edit.
    harness.engine.disposeTurn('e2e-agent', 1);
    harness.engine.disposeSession('e2e-agent');
    await harness.preStep();

    // The agent touches only the implementation.
    await writeFile(join(harness.cwd, 'src', 'auth', 'session.ts'), 'export const session = 3;\n');

    const steered = await harness.stop();
    expect(steered).toContain('docs/authentication.md');

    // `changed` must list only the agent's file, not the user's doc edit.
    const changed = await harness.command('changed');
    expect(changed.kind).toBe('success');
    expect(changed.text).toContain('src/auth/session.ts');
    expect(changed.text).not.toContain('User note');
  });

  it('updating the documentation satisfies require-resolution automatically', async () => {
    const harness = await makeHarness();
    await harness.preStep();

    await writeFile(join(harness.cwd, 'src', 'auth', 'session.ts'), 'export const session = 4;\n');
    expect(await harness.stop()).toBeDefined();

    // The agent updates the linked document in the steered step.
    await writeFile(
      join(harness.cwd, 'docs', 'authentication.md'),
      '# Authentication\n\nSessions live for 1h now.\n',
    );

    expect(await harness.stop()).toBeUndefined();
    const status = await harness.command('');
    expect(status.text).toMatch(/pending: 0/);
  });

  it('stays inert when the workspace has no config', async () => {
    const harness = await makeHarness();
    await rm(join(harness.cwd, '.dsh', 'doc-impact.yml'));
    await harness.preStep();
    await writeFile(join(harness.cwd, 'src', 'auth', 'session.ts'), 'export const session = 5;\n');
    expect(await harness.stop()).toBeUndefined();
  });
});

beforeAll(() => {}, 30_000);
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});
