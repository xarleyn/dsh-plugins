import { describe, expect, it } from 'vitest';
import { matchImpacts, normalizeConfig } from '../src/index.js';

const detectedAt = 1_700_000_000_000;

describe('impact matching', () => {
  it('maps code changes to documentation and excludes tests', () => {
    const config = normalizeConfig({
      rules: [{
        id: 'auth',
        code: { include: ['packages/auth/**'], exclude: ['**/*.test.ts'] },
        docs: ['docs/authentication.md', 'docs/security/session.md'],
        direction: 'code-to-docs',
      }],
    });

    const impacts = matchImpacts(
      config,
      ['packages/auth/session.test.ts', 'packages/auth/session.ts'],
      { detectedAt },
    );

    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toMatchObject({
      ruleId: 'auth',
      triggerSide: 'code',
      targetSide: 'docs',
      triggerFiles: ['packages/auth/session.ts'],
      targetFiles: ['docs/authentication.md', 'docs/security/session.md'],
      status: 'pending',
      detectedAt,
    });
  });

  it('automatically satisfies an impact when a target changed too', () => {
    const config = normalizeConfig({
      rules: [{
        id: 'auth',
        code: ['src/auth/**'],
        docs: ['docs/auth.md'],
        direction: 'code-to-docs',
        mode: 'require-resolution',
      }],
    });

    const [impact] = matchImpacts(config, ['src/auth/session.ts', 'docs/auth.md']);
    expect(impact?.status).toBe('updated');
  });

  it('implements docs-to-code semantics', () => {
    const config = normalizeConfig({
      rules: [{
        id: 'configuration',
        code: ['packages/config/**'],
        docs: ['docs/configuration.md'],
        direction: 'docs-to-code',
        relation: 'specification',
      }],
    });

    const [impact] = matchImpacts(
      config,
      ['docs/configuration.md'],
      { knownFiles: ['packages/config/index.ts'] },
    );
    expect(impact).toMatchObject({
      triggerSide: 'docs',
      targetSide: 'code',
      triggerFiles: ['docs/configuration.md'],
      targetFiles: ['packages/config/index.ts'],
      relation: 'specification',
    });
  });

  it('emits explainable impacts in both directions', () => {
    const config = normalizeConfig({
      rules: [{
        id: 'contract',
        code: ['src/contract.ts'],
        docs: ['docs/contract.md'],
        direction: 'bidirectional',
        relation: 'synchronized',
      }],
    });

    const impacts = matchImpacts(config, ['src/contract.ts', 'docs/contract.md']);
    expect(impacts.map(({ triggerSide, targetSide, status }) => ({
      triggerSide,
      targetSide,
      status,
    }))).toEqual([
      { triggerSide: 'code', targetSide: 'docs', status: 'updated' },
      { triggerSide: 'docs', targetSide: 'code', status: 'updated' },
    ]);
  });

  it('skips disabled and unrelated rules', () => {
    const config = normalizeConfig({
      rules: [{
        id: 'disabled',
        code: ['src/**'],
        docs: ['docs/a.md'],
        direction: 'code-to-docs',
        enabled: false,
      }],
    });
    expect(matchImpacts(config, ['src/a.ts'])).toEqual([]);
  });
});
