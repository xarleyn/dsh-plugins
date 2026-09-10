/**
 * Rule matching (SPEC §9): deterministic, fail-closed, exact-host. Rules never
 * match by substring; hosts compare against the URL's normalized hostname and
 * paths against compiled glob anchors. Pure module — the client bundle reuses
 * the path compiler for live validation.
 * @module policy/match
 */

import type { AuthenticatedFetchRule, ResolvedRule, RuleMatch } from '../types.js'
import { effectivePort } from './url.js'

/** Compile one glob path pattern (`**` = any characters, `*` = within a segment). */
export function compilePathPattern(pattern: string): RegExp | undefined {
  if (!pattern.startsWith('/')) return undefined
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char: string | undefined = pattern[index]
    if (char === undefined) break
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        // Collapse a `**` run (and the slashes it swallows) into one matcher.
        while (pattern[index + 1] === '*') index += 1
        source += '.*'
      } else {
        source += '[^/]*'
      }
      continue
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  }
  try {
    return new RegExp(`^${source}$`, 'u')
  } catch {
    return undefined
  }
}

/** Whether a URL path matches one glob pattern. */
export function pathMatches(pattern: string, pathname: string): boolean {
  const compiled = compilePathPattern(pattern)
  return compiled !== undefined && compiled.test(pathname)
}

/** Normalize one configured hostname the way `URL.hostname` normalizes. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

/** Whether a configured hostname is acceptable in v1: exact, non-wildcard, syntactically host-like. */
export function isValidConfiguredHost(host: string): boolean {
  const normalized = normalizeHost(host)
  if (normalized.length === 0 || normalized.includes('*')) return false
  // IP literals are permitted hosts (a rule for a specific internal address);
  // otherwise require hostname grammar (labels of letters/digits/hyphens).
  return isIpHost(normalized) || /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.?$/u.test(normalized)
}

function isIpHost(host: string): boolean {
  return host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)
}

function allowedSchemes(ruleMatch: RuleMatch): string[] {
  // Omitted AND schemastery-normalized-empty arrays both mean the default.
  if (ruleMatch.schemes === undefined || ruleMatch.schemes.length === 0) return ['https']
  return ruleMatch.schemes
}

/**
 * Whether the rule's match section accepts the URL, evaluated in the SPEC §9
 * order: scheme, normalized hostname, port, deny paths, allow paths.
 */
export function ruleMatchesUrl(rule: AuthenticatedFetchRule, url: URL): boolean {
  const match = rule.match
  if (!allowedSchemes(match).includes(url.protocol === 'https:' ? 'https' : 'http')) return false
  const hosts = match.hosts.map(normalizeHost)
  if (!hosts.includes(url.hostname)) return false
  if (match.ports !== undefined && match.ports.length > 0) {
    if (!match.ports.includes(effectivePort(url))) return false
  }
  const pathname = url.pathname
  if (match.denyPaths !== undefined && match.denyPaths.some(pattern => pathMatches(pattern, pathname))) {
    return false
  }
  if (match.allowPaths !== undefined && match.allowPaths.length > 0) {
    return match.allowPaths.some(pattern => pathMatches(pattern, pathname))
  }
  return true
}

/**
 * Evaluate every enabled rule against the URL. Returns all matching rule ids —
 * an empty list means no match, more than one means an ambiguous match, and
 * both fail closed (SPEC §9/§25).
 */
export function matchRules(rules: readonly ResolvedRule[], url: URL): ResolvedRule[] {
  return rules.filter(rule => rule.source.enabled && ruleMatchesUrl(rule.source, url))
}
