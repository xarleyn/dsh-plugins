/** Unit tests for model-input validation (SPEC §4). */

import { describe, expect, it } from 'vitest';

import {
  clampLineRange,
  escapeRegExpLiteral,
  validateCommitOid,
  validateRepoRelativePath,
  validateSearchLiteral,
} from '../src/git/validate.js';
import { GitToolError } from '../src/errors.js';

describe('validateCommitOid', () => {
  it('accepts abbreviated and full hexadecimal ids', () => {
    expect(validateCommitOid('deadbeef')).toBe('deadbeef');
    expect(validateCommitOid('deadbee')).toBe('deadbee');
    expect(validateCommitOid('A'.repeat(40))).toBe('A'.repeat(40));
    expect(validateCommitOid(' 0123456789abcdef0123456789abcdef01234567 ')).toBe(
      '0123456789abcdef0123456789abcdef01234567',
    );
  });

  it('rejects git options masquerading as revisions', () => {
    for (const hostile of ['-p', '--help', '--upload-pack=x', 'HEAD', 'main', 'deadbeef -p', 'zzzzzzz', 'de', '']) {
      expect(() => validateCommitOid(hostile)).toThrowError(GitToolError);
    }
  });

  it('rejects non-strings and over-long ids', () => {
    expect(() => validateCommitOid(123)).toThrowError(GitToolError);
    expect(() => validateCommitOid(undefined)).toThrowError(GitToolError);
    expect(() => validateCommitOid('a'.repeat(65))).toThrowError(GitToolError);
  });
});

describe('validateRepoRelativePath', () => {
  it('normalizes separators and collapses duplicate slashes', () => {
    expect(validateRepoRelativePath('src\\lib\\util.ts', 'path')).toBe('src/lib/util.ts');
    expect(validateRepoRelativePath('src//lib/x.ts', 'path')).toBe('src/lib/x.ts');
  });

  it('rejects absolute paths, traversal and option look-alikes', () => {
    for (const hostile of ['/etc/passwd', 'C:/windows', '..\\..\\secret', 'a/../b', 'src/-flag', 'a\0b']) {
      expect(() => validateRepoRelativePath(hostile, 'path')).toThrowError(GitToolError);
    }
  });

  it('treats absent input per the required flag', () => {
    expect(validateRepoRelativePath(undefined, 'path')).toBeUndefined();
    expect(validateRepoRelativePath('', 'path')).toBeUndefined();
    expect(() => validateRepoRelativePath(undefined, 'file', { required: true })).toThrowError(GitToolError);
    expect(() => validateRepoRelativePath('.', 'file', { required: true })).toThrowError(GitToolError);
  });

  it('enforces the length cap', () => {
    expect(() => validateRepoRelativePath('a'.repeat(2000), 'path')).toThrowError(GitToolError);
  });
});

describe('validateSearchLiteral', () => {
  it('trims and returns the literal', () => {
    expect(validateSearchLiteral('  CACHE_TTL  ', 'query')).toBe('CACHE_TTL');
    expect(escapeRegExpLiteral('a.b*c(d)')).toBe('a\\.b\\*c\\(d\\)');
  });

  it('rejects empty, non-string, NUL and over-long input', () => {
    expect(() => validateSearchLiteral('', 'query')).toThrowError(GitToolError);
    expect(() => validateSearchLiteral(42, 'query')).toThrowError(GitToolError);
    expect(() => validateSearchLiteral('a\0b', 'query')).toThrowError(GitToolError);
    expect(() => validateSearchLiteral('x'.repeat(300), 'query')).toThrowError(GitToolError);
  });
});

describe('clampLineRange', () => {
  it('defaults to a window from line 1 and flags truncation', () => {
    expect(clampLineRange(undefined, undefined, 300)).toEqual({ from: 1, to: 300, truncated: false });
    expect(clampLineRange(5, undefined, 10)).toEqual({ from: 5, to: 14, truncated: false });
  });

  it('clamps over-long explicit spans', () => {
    expect(clampLineRange(1, 5_000, 300)).toEqual({ from: 1, to: 300, truncated: true });
  });

  it('rejects inverted and non-positive ranges', () => {
    expect(() => clampLineRange(0, 10, 300)).toThrowError(GitToolError);
    expect(() => clampLineRange(10, 5, 300)).toThrowError(GitToolError);
    expect(() => clampLineRange(Number.NaN, undefined, 300)).toThrowError(GitToolError);
  });
});
