/**
 * Input validation for model-supplied tool arguments.
 *
 * The tools never accept a raw command line or git options: the only strings
 * that reach the git process are (a) hexadecimal commit ids, (b) validated
 * repository-relative paths, and (c) literal search strings passed as single
 * argv elements. Everything else is rejected before a process is spawned.
 */

import { GitToolError } from '../errors.js';

/** Abbreviated (7+) or full (40/64) hexadecimal commit id; nothing else. */
export const COMMIT_OID_PATTERN = /^[0-9a-fA-F]{7,64}$/;

/** Canonical full id as printed by `git rev-parse --verify`. */
export const FULL_OID_PATTERN = /^[0-9a-f]{40,64}$/;

export const MAX_PATH_LENGTH = 1024;

export const MAX_LITERAL_LENGTH = 256;

/**
 * Validate a model-supplied commit id.
 *
 * Anything that is not pure hexadecimal is rejected — this is what makes it
 * structurally impossible for a revision string to become a git option
 * (`-p`, `--help`, `--upload-pack=...` all fail here).
 */
export function validateCommitOid(input: unknown, field = 'oid'): string {
  if (typeof input !== 'string') {
    throw new GitToolError('invalid-oid', `${field} must be a hexadecimal commit id`);
  }
  const value = input.trim();
  if (!COMMIT_OID_PATTERN.test(value)) {
    throw new GitToolError(
      'invalid-oid',
      `${field} must be a hexadecimal commit id (7-64 hex chars), got something else`,
    );
  }
  return value;
}

/**
 * Validate a repository-relative path for use as a pathspec after `--`.
 *
 * Rejects absolute paths, drive letters, any `..` segment, NUL and option
 * look-alikes. Separators are normalized to `/` so Windows-style input works.
 * Returns the normalized path, or `undefined` for an empty/absent input when
 * `required` is false.
 */
export function validateRepoRelativePath(
  input: unknown,
  field: string,
  options: { required?: boolean } = {},
): string | undefined {
  const required = options.required ?? false;
  if (input === undefined || input === null || input === '') {
    if (required) {
      throw new GitToolError('invalid-path', `${field} is required`);
    }
    return undefined;
  }
  if (typeof input !== 'string') {
    throw new GitToolError('invalid-path', `${field} must be a string`);
  }
  if (input.includes('\0')) {
    throw new GitToolError('invalid-path', `${field} must not contain NUL bytes`);
  }
  if (input.length > MAX_PATH_LENGTH) {
    throw new GitToolError('invalid-path', `${field} is longer than ${MAX_PATH_LENGTH} characters`);
  }
  const normalized = input.replaceAll('\\', '/').replaceAll(/\/+/g, '/');
  if (normalized.startsWith('/')) {
    throw new GitToolError('invalid-path', `${field} must be repository-relative, not absolute`);
  }
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new GitToolError('invalid-path', `${field} must be repository-relative, not a drive path`);
  }
  const segments = normalized
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) {
    if (required) {
      throw new GitToolError('invalid-path', `${field} is required`);
    }
    return undefined;
  }
  for (const segment of segments) {
    if (segment === '..') {
      throw new GitToolError('invalid-path', `${field} must not traverse outside the repository`);
    }
    if (segment.startsWith('-')) {
      throw new GitToolError('invalid-path', `${field} segments must not start with "-"`);
    }
  }
  return segments.join('/');
}

/**
 * Validate a literal search string (commit-message grep, pickaxe, author).
 *
 * It is passed to git as one argv element, so no shell or option parsing can
 * be reached through it; the caps only keep pathological input cheap.
 */
export function validateSearchLiteral(input: unknown, field: string): string {
  if (typeof input !== 'string') {
    throw new GitToolError('invalid-argument', `${field} must be a string`);
  }
  if (input.includes('\0')) {
    throw new GitToolError('invalid-argument', `${field} must not contain NUL bytes`);
  }
  const value = input.trim();
  if (value === '') {
    throw new GitToolError('invalid-argument', `${field} must not be empty`);
  }
  if (value.length > MAX_LITERAL_LENGTH) {
    throw new GitToolError('invalid-argument', `${field} is longer than ${MAX_LITERAL_LENGTH} characters`);
  }
  return value;
}

/** Escape regex metacharacters so `--author=<literal>` stays a literal. */
export function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Clamp a 1-based inclusive line range for blame.
 *
 * An absent `toLine` reads at most `maxSpan` lines; an over-long explicit
 * span is truncated to `maxSpan` instead of failing, and the caller reports
 * `truncated` so the model can re-query with a narrower window.
 */
export function clampLineRange(
  fromLine: number | undefined,
  toLine: number | undefined,
  maxSpan: number,
): { from: number; to: number; truncated: boolean } {
  const from = Math.floor(fromLine ?? 1);
  if (!Number.isFinite(from) || from < 1) {
    throw new GitToolError('invalid-argument', 'fromLine must be a positive integer');
  }
  let to = toLine === undefined ? from + maxSpan - 1 : Math.floor(toLine);
  if (!Number.isFinite(to) || to < from) {
    throw new GitToolError('invalid-argument', 'toLine must be an integer greater than or equal to fromLine');
  }
  let truncated = false;
  if (to - from + 1 > maxSpan) {
    to = from + maxSpan - 1;
    truncated = true;
  }
  return { from, to, truncated };
}
