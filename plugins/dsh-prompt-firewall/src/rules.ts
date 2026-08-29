import type { FirewallDecision, FirewallSection, ResolvedPromptFirewallConfig } from './types.js'

/**
 * Verified against the upstream DSH registry. `harness:` and `deployment:` are
 * emitted by dsh-system-prompt; `tool:` and `tools:` are used for tool guidance.
 * The remaining conservative namespaces are retained for compatible hosts.
 */
export const CORE_SECTION_PREFIXES = Object.freeze([
  'harness:',
  'deployment:',
  'tool:',
  'tools:',
  'runtime:',
  'system:',
] as const)

interface CompiledPattern {
  readonly source: string
  readonly expression: RegExp
}

export interface CompiledRules {
  readonly config: ResolvedPromptFirewallConfig
  readonly protectedSections: ReadonlySet<string>
  readonly allowedSections: ReadonlySet<string>
  readonly blockedSections: ReadonlySet<string>
  readonly allowedPrefixes: readonly string[]
  readonly blockedPrefixes: readonly string[]
  readonly allowedPatterns: readonly CompiledPattern[]
  readonly blockedPatterns: readonly CompiledPattern[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (const character of glob) {
    if (character === '*') source += '.*'
    else if (character === '?') source += '.'
    else source += escapeRegExp(character)
  }
  return new RegExp(`^${source}$`, 'u')
}

function compilePatterns(patterns: readonly string[]): readonly CompiledPattern[] {
  return Object.freeze(patterns.map(source => Object.freeze({
    source,
    expression: globToRegExp(source),
  })))
}

export function compileRules(config: ResolvedPromptFirewallConfig): CompiledRules {
  return Object.freeze({
    config,
    protectedSections: new Set(config.protectedSections),
    allowedSections: new Set(config.allowedSections),
    blockedSections: new Set(config.blockedSections),
    allowedPrefixes: Object.freeze([...config.allowedPrefixes]),
    blockedPrefixes: Object.freeze([...config.blockedPrefixes]),
    allowedPatterns: compilePatterns(config.allowedPatterns),
    blockedPatterns: compilePatterns(config.blockedPatterns),
  })
}

function prefixMatch(name: string, prefixes: readonly string[]): string | undefined {
  return prefixes.find(prefix => name.startsWith(prefix))
}

function patternMatch(name: string, patterns: readonly CompiledPattern[]): string | undefined {
  return patterns.find(pattern => pattern.expression.test(name))?.source
}

export function evaluateSection(section: FirewallSection, rules: CompiledRules): FirewallDecision {
  const { name } = section
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('prompt section name must be a non-empty string')
  }

  if (rules.protectedSections.has(name)) {
    return { action: 'protect', reason: 'exact-protect', rule: name }
  }

  if (rules.config.protectCoreSections) {
    const corePrefix = prefixMatch(name, CORE_SECTION_PREFIXES)
    if (corePrefix !== undefined) {
      return { action: 'protect', reason: 'core-protect', rule: corePrefix }
    }
  }

  if (!rules.config.enabled || rules.config.mode === 'off') {
    return { action: 'allow', reason: 'mode-off' }
  }
  if (rules.config.mode === 'audit') {
    return { action: 'allow', reason: 'mode-audit' }
  }

  if (rules.allowedSections.has(name)) {
    return { action: 'allow', reason: 'exact-allow', rule: name }
  }
  if (rules.blockedSections.has(name)) {
    return { action: 'block', reason: 'exact-block', rule: name }
  }

  const allowedPrefix = prefixMatch(name, rules.allowedPrefixes)
  if (allowedPrefix !== undefined) {
    return { action: 'allow', reason: 'prefix-allow', rule: allowedPrefix }
  }
  const blockedPrefix = prefixMatch(name, rules.blockedPrefixes)
  if (blockedPrefix !== undefined) {
    return { action: 'block', reason: 'prefix-block', rule: blockedPrefix }
  }

  const allowedPattern = patternMatch(name, rules.allowedPatterns)
  if (allowedPattern !== undefined) {
    return { action: 'allow', reason: 'pattern-allow', rule: allowedPattern }
  }
  const blockedPattern = patternMatch(name, rules.blockedPatterns)
  if (blockedPattern !== undefined) {
    return { action: 'block', reason: 'pattern-block', rule: blockedPattern }
  }

  if (rules.config.mode === 'allowlist') {
    return { action: 'block', reason: 'allowlist-default' }
  }
  if (rules.config.unknownPluginPolicy === 'block' && name.startsWith('plugin:')) {
    return { action: 'block', reason: 'unknown-plugin-policy' }
  }
  return { action: 'allow', reason: 'blocklist-default' }
}

