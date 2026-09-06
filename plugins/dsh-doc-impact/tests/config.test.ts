import { describe, expect, it } from 'vitest';
import { ConfigError, normalizeConfig, parseConfig } from '../src/index.js';

describe('configuration', () => {
  it('normalizes concise selectors and defaults', () => {
    const config = parseConfig(`
rules:
  - id: auth
    code:
      - packages\\auth\\**
    docs:
      - docs/authentication.md
    direction: code-to-docs
`);

    expect(config).toEqual({
      version: 1,
      defaults: {
        mode: 'remind',
        scope: 'turn',
        changeDetection: 'auto',
      },
      rules: [{
        id: 'auth',
        code: { include: ['packages/auth/**'], exclude: [] },
        docs: { include: ['docs/authentication.md'], exclude: [] },
        direction: 'code-to-docs',
        relation: 'documents',
        mode: 'remind',
        enabled: true,
      }],
    });
  });

  it('normalizes canonical selectors and rule overrides', () => {
    const config = normalizeConfig({
      version: 1,
      defaults: { mode: 'require-resolution' },
      rules: [{
        id: 'api',
        description: 'API docs',
        code: {
          include: ['packages/api/**'],
          exclude: ['**/*.test.ts'],
        },
        docs: { include: ['docs/api/**'] },
        direction: 'bidirectional',
        relation: 'synchronized',
        mode: 'remind',
        enabled: false,
      }],
    });

    expect(config.rules[0]).toMatchObject({
      id: 'api',
      description: 'API docs',
      code: {
        include: ['packages/api/**'],
        exclude: ['**/*.test.ts'],
      },
      direction: 'bidirectional',
      relation: 'synchronized',
      mode: 'remind',
      enabled: false,
    });
  });

  it.each([
    [{ version: 2, rules: [] }, 'unsupported version'],
    [{ rules: [{ id: 'x', code: [], docs: ['docs/x.md'], direction: 'code-to-docs' }] }, 'code selector must not be empty'],
    [{ rules: [{ id: 'x', code: ['../src/**'], docs: ['docs/x.md'], direction: 'code-to-docs' }] }, 'path escapes the workspace'],
    [{ rules: [{ id: 'x', code: ['src/[abc'], docs: ['docs/x.md'], direction: 'code-to-docs' }] }, 'malformed glob'],
    [{ rules: [{ id: 'x', code: ['src/**'], docs: ['docs/x.md'], direction: 'sideways' }] }, 'direction must be one of'],
  ])('rejects invalid config: %s', (value, message) => {
    expect(() => normalizeConfig(value)).toThrow(message as string);
  });

  it('rejects duplicate IDs with rule context', () => {
    expect(() => normalizeConfig({
      rules: [
        { id: 'auth', code: ['src/**'], docs: ['docs/a.md'], direction: 'code-to-docs' },
        { id: 'auth', code: ['lib/**'], docs: ['docs/b.md'], direction: 'code-to-docs' },
      ],
    })).toThrowError(new ConfigError('duplicate rule ID', 'auth'));
  });
});
