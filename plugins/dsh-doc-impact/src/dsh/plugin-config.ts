import type { ResolutionMode } from '../config/types.js';
import { ConfigError } from '../config/errors.js';

export interface DocImpactPluginConfig {
  enabled: boolean;
  /** Workspace config path relative to the session cwd (SPEC §8, §37). */
  configFile: string;
  /** Fallback default mode for rules that declare none (SPEC §37). */
  defaultsMode: 'remind' | 'require-review' | 'require-resolution' | 'require-update';
  safety: { maxReminderRounds: number; onLimit: 'allow' | 'warn' | 'error' };
  maxSnapshotFiles: number;
  debug: boolean;
}

/**
 * The flat settings-namespace section behind the Plugin Configuration card.
 * The nested plugin-config shapes (defaults.mode, safety.*) are flattened so
 * every field is a scalar the client scope can `set`/`unset` (SPEC §37).
 */
export interface DocImpactSettingsSection {
  enabled: boolean;
  configFile: string;
  mode: ResolutionMode;
  maxReminderRounds: number;
  onLimit: 'allow' | 'warn' | 'error';
  maxSnapshotFiles: number;
  debug: boolean;
}

export const SETTINGS_DEFAULTS: DocImpactSettingsSection = {
  enabled: true,
  configFile: '.dsh/doc-impact.yml',
  mode: 'remind',
  maxReminderRounds: 2,
  onLimit: 'allow',
  maxSnapshotFiles: 10_000,
  debug: false,
};

const MODES = ['remind', 'require-review', 'require-resolution', 'require-update'] as const;
const ON_LIMIT = ['allow', 'warn', 'error'] as const;

const ON_LIMIT_VALUES = ['allow', 'warn', 'error'] as const;
const MODE_VALUES = ['remind', 'require-review', 'require-resolution', 'require-update'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new ConfigError(`${label} must be an object`);
  }
  return value;
}

/**
 * Plugin-level configuration (SPEC §37). Strict like first-party dsh plugins:
 * unknown keys fail at activation instead of being ignored silently.
 */
export function resolvePluginConfig(raw: unknown): DocImpactPluginConfig {
  const config = expectRecord(raw, 'plugin config');
  const unknown = Object.keys(config).filter(
    (key) => !['enabled', 'configFile', 'defaults', 'safety', 'changeDetection', 'debug'].includes(key),
  );
  if (unknown.length > 0) {
    throw new ConfigError(`plugin config has unknown key(s): ${unknown.join(', ')}`);
  }

  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new ConfigError('enabled must be a boolean');
  }
  if (config.configFile !== undefined && (typeof config.configFile !== 'string' || config.configFile.trim() === '')) {
    throw new ConfigError('configFile must be a non-empty string');
  }
  if (config.debug !== undefined && typeof config.debug !== 'boolean') {
    throw new ConfigError('debug must be a boolean');
  }

  const defaults = expectRecord(config.defaults, 'defaults');
  if (defaults.mode !== undefined && (typeof defaults.mode !== 'string' || !MODE_VALUES.includes(defaults.mode as never))) {
    throw new ConfigError(`defaults.mode must be one of: ${MODE_VALUES.join(', ')}`);
  }

  const safety = expectRecord(config.safety, 'safety');
  if (safety.onLimit !== undefined && (typeof safety.onLimit !== 'string' || !ON_LIMIT_VALUES.includes(safety.onLimit as never))) {
    throw new ConfigError(`safety.onLimit must be one of: ${ON_LIMIT_VALUES.join(', ')}`);
  }
  if (safety.maxReminderRounds !== undefined) {
    const rounds = safety.maxReminderRounds;
    if (typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 1) {
      throw new ConfigError('safety.maxReminderRounds must be a positive integer');
    }
  }

  const changeDetection = expectRecord(config.changeDetection, 'changeDetection');
  let maxSnapshotFiles = 10_000;
  if (changeDetection.maxSnapshotFiles !== undefined) {
    const maxFiles = changeDetection.maxSnapshotFiles;
    if (typeof maxFiles !== 'number' || !Number.isInteger(maxFiles) || maxFiles < 1) {
      throw new ConfigError('changeDetection.maxSnapshotFiles must be a positive integer');
    }
    maxSnapshotFiles = maxFiles;
  }

  return {
    enabled: config.enabled ?? true,
    configFile: config.configFile ?? '.dsh/doc-impact.yml',
    defaultsMode: (defaults.mode as DocImpactPluginConfig['defaultsMode']) ?? 'remind',
    safety: {
      maxReminderRounds: (safety.maxReminderRounds as number) ?? 2,
      onLimit: (safety.onLimit as DocImpactPluginConfig['safety']['onLimit']) ?? 'allow',
    },
    maxSnapshotFiles,
    debug: config.debug ?? false,
  };
}

/**
 * The entry-config subset declared by a profile patch row, flattened to the
 * settings section shape. Only explicitly declared fields are carried, so the
 * composition `base` never masks schema defaults for the rest.
 */
export function declaredSettingsBase(raw: unknown): Partial<DocImpactSettingsSection> {
  if (raw === undefined) return {};
  resolvePluginConfig(raw); // Validate loudly; the mapping below stays silent.
  if (!isRecord(raw)) return {};
  const base: Partial<DocImpactSettingsSection> = {};
  if (raw.enabled !== undefined) base.enabled = raw.enabled === true;
  if (raw.configFile !== undefined) base.configFile = String(raw.configFile);
  if (raw.debug !== undefined) base.debug = raw.debug === true;
  const defaults = expectRecord(raw.defaults, 'defaults');
  if (defaults.mode !== undefined) base.mode = String(defaults.mode) as DocImpactSettingsSection['mode'];
  const safety = expectRecord(raw.safety, 'safety');
  if (safety.maxReminderRounds !== undefined) base.maxReminderRounds = Number(safety.maxReminderRounds);
  if (safety.onLimit !== undefined) base.onLimit = String(safety.onLimit) as DocImpactSettingsSection['onLimit'];
  const changeDetection = expectRecord(raw.changeDetection, 'changeDetection');
  if (changeDetection.maxSnapshotFiles !== undefined) {
    base.maxSnapshotFiles = Number(changeDetection.maxSnapshotFiles);
  }
  return base;
}

function enumOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

/**
 * Resolve the effective plugin config from a settings section (schema
 * defaults → composition base → user layer). Every field is validated
 * defensively: a section written by an older schema degrades, never crashes.
 */
export function fromSettingsSection(section: unknown): DocImpactPluginConfig {
  const s = isRecord(section) ? section : {};
  return {
    enabled: s.enabled === undefined ? SETTINGS_DEFAULTS.enabled : s.enabled === true,
    configFile: typeof s.configFile === 'string' && s.configFile !== '' ? s.configFile : SETTINGS_DEFAULTS.configFile,
    defaultsMode: enumOf(s.mode, MODES, SETTINGS_DEFAULTS.mode),
    safety: {
      maxReminderRounds: positiveInt(s.maxReminderRounds, SETTINGS_DEFAULTS.maxReminderRounds),
      onLimit: enumOf(s.onLimit, ON_LIMIT, SETTINGS_DEFAULTS.onLimit),
    },
    maxSnapshotFiles: positiveInt(s.maxSnapshotFiles, SETTINGS_DEFAULTS.maxSnapshotFiles),
    debug: s.debug === undefined ? SETTINGS_DEFAULTS.debug : s.debug === true,
  };
}
