import {
  declaredSettingsBase,
  fromSettingsSection,
  type DocImpactPluginConfig,
} from './plugin-config.js';

/** The Plugin Configuration card edits this namespace (SPEC §37). */
export const DOC_IMPACT_SETTINGS_NAMESPACE = 'doc-impact';

interface SettingsService {
  register(namespace: string, schema: unknown, options?: { base?: unknown }): unknown;
  get(namespace: string): unknown;
}

interface SettingsAwareContext {
  get(service: string): unknown;
  inject(services: readonly string[], callback: (ctx: any) => void): unknown;
  logger: {
    info(message: string, ...values: unknown[]): void;
    warn(message: string, ...values: unknown[]): void;
    error(message: string, ...values: unknown[]): void;
  };
}

interface SchemasteryModule {
  default: {
    object(shape: Record<string, unknown>): unknown;
    boolean(): { default(value: boolean): unknown };
    string(): { default(value: string): unknown };
    number(): { min(value: number): { step(value: number): { default(value: number): unknown } } };
    union<T extends string>(values: readonly T[]): { default(value: T): unknown };
  };
}

function buildSchema(Schema: SchemasteryModule['default']): unknown {
  return Schema.object({
    enabled: Schema.boolean().default(true),
    configFile: Schema.string().default('.dsh/doc-impact.yml'),
    mode: Schema.union(['remind', 'require-review', 'require-resolution', 'require-update']).default('remind'),
    maxReminderRounds: Schema.number().min(1).step(1).default(2),
    onLimit: Schema.union(['allow', 'warn', 'error']).default('allow'),
    maxSnapshotFiles: Schema.number().min(1).step(1).default(10_000),
    debug: Schema.boolean().default(false),
  });
}

function readEffective(ctx: SettingsAwareContext, fallback: DocImpactPluginConfig): DocImpactPluginConfig {
  try {
    const settings = ctx.get('settings') as SettingsService | undefined;
    if (settings === undefined || typeof settings.get !== 'function') return fallback;
    return fromSettingsSection(settings.get(DOC_IMPACT_SETTINGS_NAMESPACE));
  } catch {
    return fallback;
  }
}

/**
 * Register the `doc-impact` settings namespace — the composition `base` is the
 * config the profile patch row declared, so the schema defaults sit below it
 * and the user layer above (SPEC §37). Best-effort: a missing schemastery or
 * settings service leaves the plugin running on its entry config alone.
 *
 * @param onReady - receives a live reader of the effective (merged) config.
 */
export async function bootstrapSettings(
  ctx: SettingsAwareContext,
  rawConfig: unknown,
  fallback: DocImpactPluginConfig,
  onReady: (read: () => DocImpactPluginConfig) => void,
): Promise<void> {
  const base = declaredSettingsBase(rawConfig);
  let Schema: SchemasteryModule['default'];
  try {
    const module = (await import('@deepseek-ai/schemastery')) as unknown as SchemasteryModule;
    Schema = module.default;
  } catch (error) {
    ctx.logger.warn('dsh-doc-impact: schemastery unavailable, Plugin Configuration card stays inactive (%s)', error);
    return;
  }

  const schema = buildSchema(Schema);
  ctx.inject(['settings'], (settingsCtx: { settings?: SettingsService }) => {
    const settings = settingsCtx.settings;
    if (settings === undefined || typeof settings.register !== 'function') return;
    try {
      settings.register(DOC_IMPACT_SETTINGS_NAMESPACE, schema, { base });
      ctx.logger.info('dsh-doc-impact: settings namespace %s registered', DOC_IMPACT_SETTINGS_NAMESPACE);
    } catch (error) {
      ctx.logger.warn('dsh-doc-impact: settings namespace registration failed (%s)', error);
    }
  });

  onReady(() => readEffective(ctx, fallback));
}
