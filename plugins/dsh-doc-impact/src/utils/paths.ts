import { ConfigError } from '../config/errors.js';

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;
const URI_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/u;

export function normalizeWorkspacePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  const compact = normalized.replace(/\/{2,}/gu, '/').replace(/\/$/u, '');

  if (compact.length === 0 || compact === '.') {
    throw new ConfigError('path must not be empty');
  }

  if (
    compact.startsWith('/') ||
    WINDOWS_ABSOLUTE_PATH.test(value) ||
    URI_SCHEME.test(value)
  ) {
    throw new ConfigError(`path must be workspace-relative: ${JSON.stringify(value)}`);
  }

  const segments = compact.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new ConfigError(`path escapes the workspace: ${JSON.stringify(value)}`);
  }

  return segments.filter((segment) => segment !== '.').join('/');
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
