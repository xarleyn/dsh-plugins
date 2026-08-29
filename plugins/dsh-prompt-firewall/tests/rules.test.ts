import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { compileRules, evaluateSection, globToRegExp } from '../src/rules.js'

function evaluate(name: string, config: Parameters<typeof resolveConfig>[0] = {}) {
  const rules = compileRules(resolveConfig(config))
  return evaluateSection({ name, text: 'content' }, rules)
}

describe('rule engine', () => {
  it('blocks an exact section', () => {
    expect(evaluate('plugin:dsh-ssh', { blockedSections: ['plugin:dsh-ssh'] }))
      .toEqual({ action: 'block', reason: 'exact-block', rule: 'plugin:dsh-ssh' })
  })

  it('blocks a matching prefix', () => {
    expect(evaluate('plugin:advertisement:foo', { blockedPrefixes: ['plugin:advertisement:'] }))
      .toEqual({ action: 'block', reason: 'prefix-block', rule: 'plugin:advertisement:' })
  })

  it('protects verified core namespaces before block rules', () => {
    expect(evaluate('tool:run_code', { blockedPrefixes: ['tool:'] }))
      .toEqual({ action: 'protect', reason: 'core-protect', rule: 'tool:' })
    expect(evaluate('tools:sdk', { blockedPatterns: ['tools:*'] }))
      .toEqual({ action: 'protect', reason: 'core-protect', rule: 'tools:' })
  })

  it('lets explicit allow win over a block prefix', () => {
    expect(evaluate('plugin:foo', {
      allowedSections: ['plugin:foo'],
      blockedPrefixes: ['plugin:'],
    })).toEqual({ action: 'allow', reason: 'exact-allow', rule: 'plugin:foo' })
  })

  it('honors the specified exact/prefix/pattern priority', () => {
    expect(evaluate('plugin:foo:announcement', {
      allowedPrefixes: ['plugin:foo:'],
      blockedSections: ['plugin:foo:announcement'],
      allowedPatterns: ['plugin:*'],
    })).toEqual({
      action: 'block',
      reason: 'exact-block',
      rule: 'plugin:foo:announcement',
    })
  })

  it('supports anchored glob stars and question marks', () => {
    const expression = globToRegExp('plugin:dsh-?s*')
    expect(expression.test('plugin:dsh-ssh')).toBe(true)
    expect(expression.test('xplugin:dsh-ssh')).toBe(false)
  })

  it('allows unknown sections in blocklist mode', () => {
    expect(evaluate('plugin:unknown')).toEqual({ action: 'allow', reason: 'blocklist-default' })
  })

  it('blocks unknown sections in allowlist mode unless protected', () => {
    expect(evaluate('plugin:unknown', { mode: 'allowlist' }))
      .toEqual({ action: 'block', reason: 'allowlist-default' })
    expect(evaluate('harness:identity', { mode: 'allowlist' }).action).toBe('protect')
  })

  it('applies unknownPluginPolicy only to plugin-owned sections', () => {
    expect(evaluate('plugin:unknown', { unknownPluginPolicy: 'block' }).reason)
      .toBe('unknown-plugin-policy')
    expect(evaluate('workspace:rules', { unknownPluginPolicy: 'block' }).action).toBe('allow')
  })

  it('never blocks in audit mode', () => {
    expect(evaluate('plugin:blocked', {
      mode: 'audit',
      blockedSections: ['plugin:blocked'],
    })).toEqual({ action: 'allow', reason: 'mode-audit' })
  })
})

