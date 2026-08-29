import { describe, expect, it } from 'vitest';
import { declaredSettingsBase, fromSettingsSection, resolvePluginConfig } from '../src/dsh/plugin-config.js';
import { DOC_IMPACT_SETTINGS_NAMESPACE, bootstrapSettings } from '../src/dsh/settings.js';

describe('settings section mapping', () => {
  it('maps only declared entry-config fields to the flat base', () => {
    const base = declaredSettingsBase({
      enabled: false,
      safety: { maxReminderRounds: 3 },
    });
    expect(base).toEqual({ enabled: false, maxReminderRounds: 3 });
  });

  it('maps a full entry config and rejects invalid ones', () => {
    const base = declaredSettingsBase({
      configFile: '.dsh/other.yml',
      defaults: { mode: 'require-review' },
      safety: { onLimit: 'warn', maxReminderRounds: 5 },
      changeDetection: { maxSnapshotFiles: 500 },
      debug: true,
    });
    expect(base).toEqual({
      configFile: '.dsh/other.yml',
      mode: 'require-review',
      onLimit: 'warn',
      maxReminderRounds: 5,
      maxSnapshotFiles: 500,
      debug: true,
    });
    expect(() => declaredSettingsBase({ bogus: true })).toThrow();
  });

  it('resolves a section into the nested plugin config', () => {
    const config = fromSettingsSection({
      enabled: false,
      configFile: '.dsh/x.yml',
      mode: 'require-update',
      maxReminderRounds: 4,
      onLimit: 'error',
      maxSnapshotFiles: 7,
      debug: true,
    });
    expect(config).toEqual({
      enabled: false,
      configFile: '.dsh/x.yml',
      defaultsMode: 'require-update',
      safety: { maxReminderRounds: 4, onLimit: 'error' },
      maxSnapshotFiles: 7,
      debug: true,
    });
  });

  it('degrades gracefully on missing or malformed sections', () => {
    expect(fromSettingsSection(undefined)).toEqual(resolvePluginConfig(undefined));
    const degraded = fromSettingsSection({
      configFile: 42,
      mode: 'nonsense',
      maxReminderRounds: -1,
      onLimit: 'maybe',
      maxSnapshotFiles: 1.5,
    });
    expect(degraded.configFile).toBe('.dsh/doc-impact.yml');
    expect(degraded.defaultsMode).toBe('remind');
    expect(degraded.safety).toEqual({ maxReminderRounds: 2, onLimit: 'allow' });
    expect(degraded.maxSnapshotFiles).toBe(10_000);
  });
});

interface RegisteredCall {
  namespace: string;
  schema: unknown;
  options: { base?: unknown } | undefined;
}

function makeSettingsContext(section: unknown) {
  const registered: RegisteredCall[] = [];
  const injected: string[][] = [];
  const service = {
    register(namespace: string, schema: unknown, options?: { base?: unknown }) {
      registered.push({ namespace, schema, options });
    },
    get(namespace: string) {
      void namespace;
      return section;
    },
  };
  const ctx = {
    injected,
    registered,
    get(serviceName: string) {
      if (serviceName !== 'settings') return undefined;
      return service;
    },
    inject(services: readonly string[], callback: (c: { settings?: unknown }) => void) {
      injected.push([...services]);
      callback({ settings: service });
    },
    logger: { warn() {}, info() {}, error() {} },
  };
  return ctx;
}

describe('bootstrapSettings', () => {
  it('registers the namespace with the entry-config base and serves the merged view', async () => {
    const ctx = makeSettingsContext({
      enabled: true,
      configFile: '.dsh/from-user.yml',
      mode: 'require-review',
      maxReminderRounds: 3,
      onLimit: 'warn',
      maxSnapshotFiles: 500,
      debug: true,
    });
    let read: (() => ReturnType<typeof fromSettingsSection>) | undefined;
    await bootstrapSettings(ctx, { defaults: { mode: 'remind' } }, resolvePluginConfig(undefined), (r) => {
      read = r;
    });

    expect(ctx.injected).toEqual([['settings']]);
    expect(ctx.registered).toHaveLength(1);
    expect(ctx.registered[0]!.namespace).toBe(DOC_IMPACT_SETTINGS_NAMESPACE);
    expect(ctx.registered[0]!.options).toEqual({ base: { mode: 'remind' } });
    expect(ctx.registered[0]!.schema).toBeDefined();

    expect(read).toBeDefined();
    expect(read!().configFile).toBe('.dsh/from-user.yml');
    expect(read!().defaultsMode).toBe('require-review');
    expect(read!().safety).toEqual({ maxReminderRounds: 3, onLimit: 'warn' });
  });

  it('falls back to the entry config when the settings service is absent', async () => {
    const ctx = makeSettingsContext(undefined);
    ctx.get = () => undefined;
    let read: (() => ReturnType<typeof fromSettingsSection>) | undefined;
    await bootstrapSettings(
      ctx,
      { safety: { onLimit: 'warn' } },
      resolvePluginConfig({ safety: { onLimit: 'warn' } }),
      (r) => {
        read = r;
      },
    );
    expect(read).toBeDefined();
    expect(read!().safety.onLimit).toBe('warn');
  });
});
