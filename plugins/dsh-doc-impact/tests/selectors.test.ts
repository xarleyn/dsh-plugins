import { describe, expect, it } from 'vitest';
import {
  matchesSelector,
  materializeSelector,
  normalizeWorkspacePath,
} from '../src/index.js';

describe('selectors', () => {
  const selector = {
    include: ['packages/api/**', 'packages/sdk'],
    exclude: ['**/*.test.ts', '**/__fixtures__/**'],
  };

  it('matches globs, directories, and Windows-style candidate paths', () => {
    expect(matchesSelector('packages\\api\\src\\index.ts', selector)).toBe(true);
    expect(matchesSelector('packages/sdk/src/client.ts', selector)).toBe(true);
    expect(matchesSelector('packages/api/src/index.test.ts', selector)).toBe(false);
    expect(matchesSelector('packages/api/__fixtures__/response.ts', selector)).toBe(false);
    expect(matchesSelector('packages/other/index.ts', selector)).toBe(false);
  });

  it('materializes known glob matches and preserves literal missing targets', () => {
    expect(materializeSelector(
      { include: ['docs/**/*.md', 'docs/missing.md'], exclude: ['docs/internal/**'] },
      ['docs/api.md', 'docs/internal/debug.md'],
    )).toEqual(['docs/api.md', 'docs/missing.md']);
  });

  it('normalizes workspace paths to POSIX style', () => {
    expect(normalizeWorkspacePath('.\\packages\\auth\\src\\index.ts'))
      .toBe('packages/auth/src/index.ts');
  });
});
