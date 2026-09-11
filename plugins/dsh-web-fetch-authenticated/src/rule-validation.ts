/**
 * Shared, environment-free configuration validation (SPEC §24). The Host runs
 * these checks as the settings backstop and before a rule takes effect; the
 * browser card runs the same functions live so a rejected write is explained
 * in the form. Everything here returns plain strings — no Node, no WebError.
 * @module rule-validation
 */

import type { AdapterConfig, AuthConfig, AuthenticatedFetchRule, AuthType, WebFetchAuthConfig, NetworkPolicy, RedirectPolicy } from './types.js'
import { isCidr } from './policy/network.js'
import { compilePathPattern, isValidConfiguredHost, normalizeHost } from './policy/match.js'

/** Transport headers a credential must never be configurable into (SPEC §8.3). */
export const FORBIDDEN_HEADER_NAMES: readonly string[] = Object.freeze([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'proxy-authorization',
  'proxy-authenticate',
  'authorization',
  'cookie',
  'set-cookie',
  'expect',
  'te',
  'trailer',
  'upgrade',
])

/** Grammar of a header field name. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u

/** Validate a syntactically valid credential reference name (full POSIX identifier). */
export function isCredentialRef(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)
}

export interface ConfigValidation {
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Validate one rule; returns localized-free diagnostic strings. */
export function validateRule(rule: AuthenticatedFetchRule, index: number): string[] {
  const label = rule.id.length > 0 ? `rule "${rule.id}"` : `rule #${index + 1}`
  const errors: string[] = []
  if (typeof rule.id !== 'string' || rule.id.trim().length === 0) errors.push(`${label}: id must be a non-empty string`)
  if (typeof rule.name !== 'string' || rule.name.trim().length === 0) errors.push(`${label}: name must be a non-empty string`)
  if (typeof rule.enabled !== 'boolean') errors.push(`${label}: enabled must be a boolean`)

  const match = rule.match
  if (match === undefined || typeof match !== 'object') {
    errors.push(`${label}: match section is required`)
    return errors
  }
  const hosts = match.hosts
  if (!Array.isArray(hosts) || hosts.length === 0) {
    errors.push(`${label}: at least one host is required`)
  } else {
    for (const host of hosts) {
      if (typeof host !== 'string' || !isValidConfiguredHost(host)) {
        errors.push(`${label}: host "${String(host)}" is not a valid exact hostname (wildcards are not supported in v1)`)
      }
    }
  }
  const schemes = match.schemes
  if (schemes !== undefined) {
    // Schemastery normalizes omitted arrays to `[]`: treat empty as absent
    // (the https-only default applies).
    if (!Array.isArray(schemes)) {
      errors.push(`${label}: schemes must be an array when present`)
    } else if (schemes.length > 0) {
      for (const scheme of schemes) {
        if (scheme !== 'https' && scheme !== 'http') errors.push(`${label}: unsupported scheme "${String(scheme)}"`)
      }
    }
  }
  if (match.ports !== undefined) {
    const ports = match.ports
    if (!Array.isArray(ports)) {
      errors.push(`${label}: ports must be an array when present`)
    } else if (ports.length > 0) {
      for (const port of ports) {
        if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
          errors.push(`${label}: port ${String(port)} is not an integer in 1..65535`)
        }
      }
    }
  }
  for (const [field, patterns] of [['allowPaths', match.allowPaths], ['denyPaths', match.denyPaths]] as const) {
    if (patterns === undefined || (Array.isArray(patterns) && patterns.length === 0)) continue
    if (!Array.isArray(patterns)) {
      errors.push(`${label}: ${field} must be an array when present`)
      continue
    }
    for (const pattern of patterns) {
      if (typeof pattern !== 'string' || compilePathPattern(pattern) === undefined) {
        errors.push(`${label}: malformed ${field} pattern "${String(pattern)}" (must start with "/")`)
      }
    }
  }

  errors.push(...validateAdapter(rule.adapter, label))

  errors.push(...validateAuth(rule.auth, label))

  errors.push(...validateNetworkPolicy(rule.networkPolicy, label))
  errors.push(...validateRedirectPolicy(rule.redirects, label))

  const limits = rule.limits
  if (limits !== undefined) {
    if (limits.timeoutMs !== undefined && !isPositiveFinite(limits.timeoutMs)) errors.push(`${label}: limits.timeoutMs must be a positive number`)
    if (limits.maxResponseBytes !== undefined && !isPositiveFinite(limits.maxResponseBytes)) errors.push(`${label}: limits.maxResponseBytes must be a positive number`)
    if (limits.maxBodyChars !== undefined && !isPositiveFinite(limits.maxBodyChars)) errors.push(`${label}: limits.maxBodyChars must be a positive number`)
  }
  if (rule.testUrl !== undefined && rule.testUrl.length > 0) {
    try {
      const testUrl = new URL(rule.testUrl)
      if (testUrl.protocol !== 'https:' && testUrl.protocol !== 'http:') errors.push(`${label}: testUrl must be http(s)`)
    } catch {
      errors.push(`${label}: testUrl is not a valid absolute URL`)
    }
  }
  return errors
}

function validateAdapter(adapter: AdapterConfig | undefined, label: string): string[] {
  if (adapter === undefined) return []
  const errors: string[] = []
  const type = adapter.type
  // Schemastery normalizes an absent section to `{}`; treat a missing type as
  // absent rather than invalid, and still validate any other present fields.
  if (type !== undefined && type !== 'none' && type !== 'jira' && type !== 'confluence') {
    errors.push(`${label}: unsupported adapter type "${String(type)}"`)
  }
  const flavor = adapter.jiraFlavor
  if (flavor !== undefined && flavor !== 'server' && flavor !== 'cloud') {
    errors.push(`${label}: adapter.jiraFlavor must be "server" or "cloud"`)
  }
  for (const field of ['includeComments', 'includeLinks'] as const) {
    const value = adapter[field]
    if (value !== undefined && typeof value !== 'boolean') errors.push(`${label}: adapter.${field} must be a boolean`)
  }
  return errors
}

function validateAuth(auth: AuthConfig | undefined, label: string): string[] {
  const errors: string[] = []
  if (auth === undefined || typeof auth !== 'object') {
    errors.push(`${label}: auth section is required`)
    return errors
  }
  const type = auth.type
  if (!isAuthType(type)) {
    errors.push(`${label}: unsupported auth type "${String(type)}"`)
    return errors
  }
  if (type === 'none') return errors
  if (type === 'bearer') {
    if (!isCredentialRef(auth.credential)) errors.push(`${label}: bearer auth requires a valid credential reference name`)
  } else if (type === 'basic') {
    if (typeof auth.username !== 'string' || auth.username.length === 0) errors.push(`${label}: basic auth requires a username`)
    if (!isCredentialRef(auth.passwordCredential)) errors.push(`${label}: basic auth requires a valid password credential reference name`)
  } else {
    if (typeof auth.headerName !== 'string' || !HEADER_NAME_PATTERN.test(auth.headerName)) {
      errors.push(`${label}: header auth requires a valid header name`)
    } else if (FORBIDDEN_HEADER_NAMES.includes(auth.headerName.toLowerCase())) {
      errors.push(`${label}: header name "${auth.headerName}" is a forbidden transport header`)
    }
    if (!isCredentialRef(auth.credential)) errors.push(`${label}: header auth requires a valid credential reference name`)
    if (auth.prefix !== undefined && typeof auth.prefix !== 'string') errors.push(`${label}: header prefix must be a string when present`)
  }
  return errors
}

function validateNetworkPolicy(policy: NetworkPolicy | undefined, label: string): string[] {
  if (policy === undefined) return []
  const errors: string[] = []
  for (const [field, cidrs] of [['allowedCidrs', policy.allowedCidrs], ['deniedCidrs', policy.deniedCidrs]] as const) {
    if (cidrs === undefined || (Array.isArray(cidrs) && cidrs.length === 0)) continue
    if (!Array.isArray(cidrs)) {
      errors.push(`${label}: networkPolicy.${field} must be an array when present`)
      continue
    }
    for (const cidr of cidrs) {
      if (typeof cidr !== 'string' || !isCidr(cidr)) errors.push(`${label}: malformed networkPolicy.${field} CIDR "${String(cidr)}"`)
    }
  }
  return errors
}

function validateRedirectPolicy(policy: RedirectPolicy | undefined, label: string): string[] {
  if (policy === undefined) return []
  const errors: string[] = []
  const mode = policy.mode
  if (mode !== undefined && mode !== 'none' && mode !== 'same-origin' && mode !== 'allowlist') {
    errors.push(`${label}: redirect mode must be none, same-origin, or allowlist`)
  }
  if (policy.maxRedirects !== undefined) {
    const redirects = policy.maxRedirects
    if (typeof redirects !== 'number' || !Number.isInteger(redirects) || redirects < 0) {
      errors.push(`${label}: redirects.maxRedirects must be a non-negative integer`)
    }
  }
  // Only allowlist mode requires entries; an empty list for other modes is
  // schemastery's normalized "absent".
  if (mode === 'allowlist') {
    const origins = policy.allowedOrigins
    if (!Array.isArray(origins) || origins.length === 0) {
      errors.push(`${label}: redirect mode allowlist requires a non-empty allowedOrigins list`)
    } else {
      for (const origin of origins) {
        if (!isValidOrigin(origin)) errors.push(`${label}: redirect allowedOrigins entry "${String(origin)}" is not an http(s) origin`)
      }
    }
  } else if (policy.allowedOrigins !== undefined && Array.isArray(policy.allowedOrigins)) {
    for (const origin of policy.allowedOrigins) {
      if (!isValidOrigin(origin)) errors.push(`${label}: redirect allowedOrigins entry "${String(origin)}" is not an http(s) origin`)
    }
  }
  return errors
}

/** Validate a whole config: rule-level errors plus id uniqueness and ambiguity warnings. */
export function validateConfig(config: WebFetchAuthConfig): ConfigValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const rules = config.rules ?? []
  const seenIds = new Set<string>()
  for (const [index, rule] of rules.entries()) {
    errors.push(...validateRule(rule, index))
    if (typeof rule.id === 'string' && rule.id.length > 0) {
      if (seenIds.has(rule.id)) errors.push(`duplicate rule id "${rule.id}"`)
      seenIds.add(rule.id)
    }
    if (rule.enabled !== false) {
      const schemes = rule.match?.schemes
      if (schemes !== undefined && schemes.includes('http')) {
        warnings.push(`rule "${rule.id}": http:// is allowed; responses travel unencrypted`)
      }
      const policy = rule.networkPolicy
      if (policy?.allowPrivate === true && (policy.allowedCidrs === undefined || policy.allowedCidrs.length === 0)) {
        warnings.push(`rule "${rule.id}": all RFC1918 private ranges are allowed; prefer narrow allowedCidrs`)
      }
      if (policy?.allowLoopback === true) {
        warnings.push(`rule "${rule.id}": loopback destinations are allowed`)
      }
      if (rule.match.allowPaths === undefined || rule.match.allowPaths.length === 0) {
        warnings.push(`rule "${rule.id}": every path on the matched origin is allowed; add allowPaths to narrow it`)
      }
    }
  }
  // Ambiguity warning: two enabled rules whose schemes/hosts/ports overlap.
  for (let a = 0; a < rules.length; a += 1) {
    const ruleA = rules[a]
    if (ruleA === undefined || ruleA.enabled === false) continue
    for (let b = a + 1; b < rules.length; b += 1) {
      const ruleB = rules[b]
      if (ruleB === undefined || ruleB.enabled === false) continue
      if (rulesOverlap(ruleA, ruleB)) {
        warnings.push(`rules "${ruleA.id}" and "${ruleB.id}" may match the same URLs; a request will fail with AUTH_FETCH_AMBIGUOUS_MATCH`)
      }
    }
  }
  return { errors, warnings }
}

function isAuthType(value: unknown): value is AuthType {
  return value === 'none' || value === 'bearer' || value === 'basic' || value === 'header'
}

function isValidOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.origin === value && (url.protocol === 'https:' || url.protocol === 'http:')
  } catch {
    return false
  }
}

/** Whether two enabled rules can ever accept the same URL (coarse over-approximation). */
function rulesOverlap(a: AuthenticatedFetchRule, b: AuthenticatedFetchRule): boolean {
  const schemesOf = (match: typeof a.match): string[] => (match.schemes === undefined || match.schemes.length === 0 ? ['https'] : match.schemes)
  const schemesA = schemesOf(a.match)
  const schemesB = schemesOf(b.match)
  if (!schemesA.some(scheme => schemesB.includes(scheme))) return false
  const hostsA = a.match.hosts.map(normalizeHost)
  const hostsB = b.match.hosts.map(normalizeHost)
  if (!hostsA.some(host => hostsB.includes(host))) return false
  const portsA = a.match.ports
  const portsB = b.match.ports
  if (portsA !== undefined && portsA.length > 0 && portsB !== undefined && portsB.length > 0) {
    if (!portsA.some(port => portsB.includes(port))) return false
  }
  // Path sets: when either rule allows every path, they overlap; otherwise the
  // deny/allow globs are not precisely intersectable without the URL, so the
  // check stays coarse and reports a warning instead of a hard error.
  return true
}
