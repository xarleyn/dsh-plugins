import picomatch from 'picomatch';
import { ConfigError } from './errors.js';
import {
  CHANGE_DETECTION_MODES,
  DIRECTIONS,
  RELATIONS,
  RESOLUTION_MODES,
  SCOPES,
  type ChangeDetectionMode,
  type DocImpactConfig,
  type FileSelector,
  type ImpactRule,
  type ResolutionMode,
  type Scope,
} from './types.js';
import { normalizeWorkspacePath } from '../utils/paths.js';

type UnknownRecord = Record<string, unknown>;

const DEFAULT_MODE: ResolutionMode = 'remind';
const DEFAULT_SCOPE: Scope = 'turn';
const DEFAULT_CHANGE_DETECTION: ChangeDetectionMode = 'auto';

export interface ConfigFallbacks {
  mode?: ResolutionMode;
  scope?: Scope;
  changeDetection?: ChangeDetectionMode;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string, ruleId?: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new ConfigError(`${label} must be an object`, ruleId);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  fallback: T | undefined,
  ruleId?: string,
): T {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ConfigError(
      `${label} must be one of: ${allowed.join(', ')}`,
      ruleId,
    );
  }
  return value as T;
}

function validateGlob(pattern: string, ruleId: string): void {
  let brackets = 0;
  let braces = 0;
  let escaped = false;

  for (const character of pattern) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '[') brackets += 1;
    if (character === ']') brackets -= 1;
    if (character === '{') braces += 1;
    if (character === '}') braces -= 1;
    if (brackets < 0 || braces < 0) break;
  }

  if (escaped || brackets !== 0 || braces !== 0) {
    throw new ConfigError(`malformed glob: ${JSON.stringify(pattern)}`, ruleId);
  }

  try {
    picomatch.makeRe(pattern);
  } catch {
    throw new ConfigError(`malformed glob: ${JSON.stringify(pattern)}`, ruleId);
  }
}

function normalizePatterns(
  value: unknown,
  label: string,
  ruleId: string,
  allowEmpty: boolean,
): string[] {
  if (value === undefined && allowEmpty) return [];
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || values.some((item) => typeof item !== 'string')) {
    throw new ConfigError(`${label} must be a string or an array of strings`, ruleId);
  }

  const normalized = [...new Set(values.map((item) => {
    try {
      return normalizeWorkspacePath(item as string);
    } catch (error) {
      if (error instanceof ConfigError) {
        throw new ConfigError(`${label}: ${error.message.split('\n').at(-1)}`, ruleId);
      }
      throw error;
    }
  }))];

  if (!allowEmpty && normalized.length === 0) {
    throw new ConfigError(`${label} must not be empty`, ruleId);
  }
  for (const pattern of normalized) validateGlob(pattern, ruleId);
  return normalized;
}

function normalizeSelector(value: unknown, label: string, ruleId: string): FileSelector {
  if (typeof value === 'string' || Array.isArray(value)) {
    return {
      include: normalizePatterns(value, `${label} selector`, ruleId, false),
      exclude: [],
    };
  }

  const selector = expectRecord(value, `${label} selector`, ruleId);
  return {
    include: normalizePatterns(selector.include, `${label} selector`, ruleId, false),
    exclude: normalizePatterns(selector.exclude, `${label} exclude`, ruleId, true),
  };
}

function normalizeRule(
  value: unknown,
  index: number,
  defaultMode: ResolutionMode,
): ImpactRule {
  const raw = expectRecord(value, `rules[${index}]`);
  if (typeof raw.id !== 'string' || raw.id.trim().length === 0) {
    throw new ConfigError(`rules[${index}].id must be a non-empty string`);
  }
  const id = raw.id.trim();

  if (raw.description !== undefined && typeof raw.description !== 'string') {
    throw new ConfigError('description must be a string', id);
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new ConfigError('enabled must be a boolean', id);
  }

  const rule: ImpactRule = {
    id,
    code: normalizeSelector(raw.code, 'code', id),
    docs: normalizeSelector(raw.docs, 'docs', id),
    direction: enumValue(raw.direction, DIRECTIONS, 'direction', undefined, id),
    relation: enumValue(raw.relation, RELATIONS, 'relation', 'documents', id),
    mode: enumValue(raw.mode, RESOLUTION_MODES, 'mode', defaultMode, id),
    enabled: raw.enabled ?? true,
  };
  if (raw.description !== undefined) rule.description = raw.description;
  return rule;
}

export function normalizeConfig(value: unknown, fallbacks: ConfigFallbacks = {}): DocImpactConfig {
  const raw = expectRecord(value, 'configuration');
  const version = raw.version ?? 1;
  if (version !== 1) {
    throw new ConfigError(`unsupported version: ${JSON.stringify(version)}`);
  }

  const defaults = raw.defaults === undefined
    ? {}
    : expectRecord(raw.defaults, 'defaults');
  const mode = enumValue(defaults.mode, RESOLUTION_MODES, 'defaults.mode', fallbacks.mode ?? DEFAULT_MODE);
  const scope = enumValue(defaults.scope, SCOPES, 'defaults.scope', fallbacks.scope ?? DEFAULT_SCOPE);
  const changeDetection = enumValue(
    defaults.changeDetection,
    CHANGE_DETECTION_MODES,
    'defaults.changeDetection',
    fallbacks.changeDetection ?? DEFAULT_CHANGE_DETECTION,
  );

  if (!Array.isArray(raw.rules)) {
    throw new ConfigError('rules must be an array');
  }
  const rules = raw.rules.map((rule, index) => normalizeRule(rule, index, mode));
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) {
      throw new ConfigError('duplicate rule ID', rule.id);
    }
    seen.add(rule.id);
  }

  return {
    version: 1,
    defaults: { mode, scope, changeDetection },
    rules,
  };
}
