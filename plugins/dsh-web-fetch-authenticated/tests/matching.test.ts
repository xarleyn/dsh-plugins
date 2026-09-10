/**
 * Unit tests for rule matching and path globs (SPEC §9/§26.1).
 */

import { describe, expect, test } from 'vitest'
import { compilePathPattern, matchRules, pathMatches, ruleMatchesUrl } from '../src/policy/match.js'
import { validateFetchUrl } from '../src/policy/url.js'
import { ConfigSchema, resolveConfig } from '../src/config.js'
import { validateRule } from '../src/rule-validation.js'
import { configWith, fixtureRule } from './helpers.js'

function url(text: string): URL {
  return validateFetchUrl(text, 2048)
}

describe('path globs', () => {
  test('** crosses segments, * stays within one', () => {
    expect(pathMatches('/browse/**', '/browse/a/b/c')).toBe(true)
    expect(pathMatches('/browse/*', '/browse/a/b')).toBe(false)
    expect(pathMatches('/browse/*', '/browse/a')).toBe(true)
    expect(pathMatches('/rest/api/**', '/rest/api/2/issue/MDC-1')).toBe(true)
    expect(pathMatches('/browse/**', '/browser')).toBe(false)
  })

  test('regex metacharacters in patterns are literal', () => {
    expect(pathMatches('/a.b', '/aXb')).toBe(false)
    expect(pathMatches('/a.b', '/a.b')).toBe(true)
    expect(pathMatches('/x(y)', '/x(y)')).toBe(true)
  })

  test('malformed patterns do not compile and never match', () => {
    expect(compilePathPattern('browse/**')).toBeUndefined()
    expect(pathMatches('browse/**', '/browse/x')).toBe(false)
  })
})

describe('rule matching order', () => {
  test('scheme, host, port, deny, allow', () => {
    const rule = fixtureRule('http://127.0.0.1:1', {
      match: {
        schemes: ['https'],
        hosts: ['jira.example.corp'],
        ports: [8443],
        allowPaths: ['/browse/**'],
        denyPaths: ['/browse/admin/**'],
      },
    })
    expect(ruleMatchesUrl(rule, url('https://jira.example.corp:8443/browse/MDC-1'))).toBe(true)
    expect(ruleMatchesUrl(rule, url('http://jira.example.corp:8443/browse/MDC-1'))).toBe(false)
    expect(ruleMatchesUrl(rule, url('https://jira.example.corp/browse/MDC-1'))).toBe(false)
    expect(ruleMatchesUrl(rule, url('https://jira.example.corp:8443/browse/admin/x'))).toBe(false)
    expect(ruleMatchesUrl(rule, url('https://jira.example.corp:8443/other'))).toBe(false)
  })

  test('hostname normalization is exact, not substring', () => {
    const rule = fixtureRule('http://127.0.0.1:1', { match: { hosts: ['JIRA.Example.Corp'] } })
    expect(ruleMatchesUrl(rule, url('https://jira.example.corp/x'))).toBe(true)
    expect(ruleMatchesUrl(rule, url('https://xjira.example.corp/x'))).toBe(false)
  })

  test('empty ports allow any port; default ports count', () => {
    const rule = fixtureRule('http://127.0.0.1:1', {
      match: { schemes: ['https'], hosts: ['svc.example'] },
    })
    expect(ruleMatchesUrl(rule, url('https://svc.example/x'))).toBe(true)
    expect(ruleMatchesUrl(rule, url('https://svc.example:8443/x'))).toBe(true)
  })

  test('no allowPaths allows every path on the origin', () => {
    const rule = fixtureRule('http://127.0.0.1:1', { match: { hosts: ['svc.example'] } })
    expect(ruleMatchesUrl(rule, url('https://svc.example/any/thing'))).toBe(true)
  })
})

describe('config resolution', () => {
  test('invalid rules are dropped and reported', () => {
    const good = fixtureRule('http://127.0.0.1:1', { id: 'good' })
    const bad = fixtureRule('http://127.0.0.1:1', { id: 'bad', match: { hosts: [] } })
    const resolved = resolveConfig(configWith([good, bad]))
    expect(resolved.rules.map(rule => rule.source.id)).toEqual(['good'])
    expect(resolved.configErrors.length).toBeGreaterThan(0)
    expect(resolved.configErrors.some(error => error.includes('bad'))).toBe(true)
  })

  test('defaults are restrictive: https-only, no private, same-origin redirects', () => {
    const rule = fixtureRule('http://127.0.0.1:1', { networkPolicy: {} })
    const resolved = resolveConfig(configWith([rule]))
    const resolvedRule = resolved.rules[0]!
    expect(resolvedRule.networkPolicy.allowPrivate).toBe(false)
    expect(resolvedRule.networkPolicy.allowLoopback).toBe(false)
    expect(resolvedRule.networkPolicy.allowLinkLocal).toBe(false)
    expect(resolvedRule.redirects.mode).toBe('same-origin')
    expect(resolvedRule.redirects.maxRedirects).toBe(3)
    expect(resolvedRule.limits.timeoutMs).toBe(30_000)
    expect(resolved.unmatchedPolicy).toBe('block')
  })

  test('rule limits override global limits', () => {
    const rule = fixtureRule('http://127.0.0.1:1', { limits: { timeoutMs: 1234 } })
    const resolved = resolveConfig(configWith([rule], { limits: { timeoutMs: 9999, maxBodyChars: 555 } }))
    expect(resolved.rules[0]?.limits.timeoutMs).toBe(1234)
    expect(resolved.rules[0]?.limits.maxBodyChars).toBe(555)
    expect(resolved.limits.timeoutMs).toBe(9999)
  })

  test('validateRule flags a missing credential reference grammar', () => {
    const rule = fixtureRule('http://127.0.0.1:1', { auth: { type: 'bearer', credential: 'not a ref' } })
    expect(validateRule(rule, 0).some(error => error.includes('credential reference'))).toBe(true)
  })

  test('schemastery-normalized empty arrays read as absent (round-trip through settings)', () => {
    // What the settings section actually stores after schemastery resolves a
    // rule written with only the required fields.
    const normalized = ConfigSchema({
      rules: [{
        id: 'r1',
        name: 'R1',
        enabled: true,
        match: { hosts: ['jira.example.corp'] },
        auth: { type: 'bearer', credential: 'JIRA_TOKEN' },
      }],
    })
    expect(validateRule(normalized.rules![0]!, 0)).toEqual([])
    const resolved = resolveConfig(normalized)
    expect(resolved.rules).toHaveLength(1)
    // Default schemes still https-only after normalization.
    expect(matchRules(resolved.rules, url('http://jira.example.corp/x'))).toHaveLength(0)
    expect(matchRules(resolved.rules, url('https://jira.example.corp/x'))).toHaveLength(1)
  })

  test('matchRules ignores disabled rules even when the URL fits', () => {
    const resolved = resolveConfig(configWith([fixtureRule('http://127.0.0.1:1', { enabled: false })]))
    expect(matchRules(resolved.rules, url('http://127.0.0.1:1/secure/x'))).toHaveLength(0)
  })
})
