/**
 * Plugin configuration (SPEC §7/§23): the schemastery schema the Cordis loader
 * and the settings section share, plus `resolveConfig`, which applies
 * security-oriented defaults, validates rules, and drops the invalid ones with
 * reported reasons (fail closed, SPEC §32.6).
 * @module config
 */

import z from '@deepseek-ai/schemastery'
import type {
  AuthConfig,
  AuditConfig,
  AuthenticatedFetchRule,
  WebFetchAuthConfig,
  DefaultPolicy,
  FetchLimits,
  NetworkPolicy,
  ResolvedConfig,
  ResolvedRule,
  RedirectPolicy,
  RuleMatch,
} from './types.js'
import { validateRule } from './rule-validation.js'

export const DEFAULT_LIMITS: Readonly<Required<FetchLimits>> = Object.freeze({
  timeoutMs: 30_000,
  maxResponseBytes: 5_242_880,
  maxBodyChars: 100_000,
})

export const DEFAULT_USER_AGENT = 'deepseek-harness-authenticated-fetch (+https://github.com/xarleyn/dsh-plugins)'
/** Maximum accepted request URL length; a transport constant, not a rule limit. */
export const DEFAULT_MAX_URL_LENGTH = 2048
export const DEFAULT_MAX_REDIRECTS = 3

const EMPTY_NETWORK_POLICY: Readonly<Required<Omit<NetworkPolicy, 'allowedCidrs' | 'deniedCidrs'>>> = Object.freeze({
  allowPublic: true,
  allowPrivate: false,
  allowLoopback: false,
  allowLinkLocal: false,
  allowCGNAT: false,
  allowIPv6ULA: false,
})

const fetchLimitsSchema = z.object({
  timeoutMs: z.number().step(1).min(1),
  maxResponseBytes: z.number().step(1).min(1),
  maxBodyChars: z.number().step(1).min(1),
})

const networkPolicySchema = z.object({
  allowPublic: z.boolean(),
  allowPrivate: z.boolean(),
  allowLoopback: z.boolean(),
  allowLinkLocal: z.boolean(),
  allowCGNAT: z.boolean(),
  allowIPv6ULA: z.boolean(),
  allowedCidrs: z.array(z.string()),
  deniedCidrs: z.array(z.string()),
})

const redirectSchema = z.object({
  mode: z.union(['none', 'same-origin', 'allowlist'] as const),
  maxRedirects: z.number().step(1).min(0),
  allowedOrigins: z.array(z.string()),
})

const authSchema = z.union([
  z.object({ type: z.union(['none'] as const) }),
  z.object({ type: z.union(['bearer'] as const), credential: z.string() }),
  z.object({ type: z.union(['basic'] as const), username: z.string(), passwordCredential: z.string() }),
  z.object({ type: z.union(['header'] as const), headerName: z.string(), credential: z.string(), prefix: z.string() }),
]) as unknown as z<AuthConfig>

const ruleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  testUrl: z.string(),
  match: z.object({
    schemes: z.array(z.union(['https', 'http'] as const)),
    hosts: z.array(z.string()),
    ports: z.array(z.number().step(1).min(1).max(65535)),
    allowPaths: z.array(z.string()),
    denyPaths: z.array(z.string()),
  }) as z<RuleMatch>,
  auth: authSchema,
  networkPolicy: networkPolicySchema as z<NetworkPolicy>,
  redirects: redirectSchema as z<RedirectPolicy>,
  limits: fetchLimitsSchema as z<FetchLimits>,
})

/** Runtime schema consumed by the Cordis loader and the settings section. */
export const ConfigSchema: z<WebFetchAuthConfig> = z.object({
  configVersion: z.number().step(1).min(1).default(1),
  enabled: z.boolean().default(true),
  rules: z.array(ruleSchema).default([]) as z<AuthenticatedFetchRule[]>,
  defaultPolicy: z.object({
    unmatched: z.union(['block'] as const),
  }) as z<DefaultPolicy>,
  limits: fetchLimitsSchema as z<FetchLimits>,
  audit: z.object({
    enabled: z.boolean().default(true),
  }).default({ enabled: true } satisfies AuditConfig) as z<AuditConfig>,
})

/** Merge one rule's limits over the global defaults. */
function resolveLimits(globalLimits: FetchLimits | undefined, ruleLimits: FetchLimits | undefined): Required<FetchLimits> {
  return {
    timeoutMs: ruleLimits?.timeoutMs ?? globalLimits?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
    maxResponseBytes: ruleLimits?.maxResponseBytes ?? globalLimits?.maxResponseBytes ?? DEFAULT_LIMITS.maxResponseBytes,
    maxBodyChars: ruleLimits?.maxBodyChars ?? globalLimits?.maxBodyChars ?? DEFAULT_LIMITS.maxBodyChars,
  }
}

function resolveRule(rule: AuthenticatedFetchRule, globalLimits: FetchLimits | undefined): ResolvedRule {
  const networkPolicySource = rule.networkPolicy ?? {}
  const redirects = rule.redirects ?? {}
  return {
    source: rule,
    networkPolicy: Object.freeze({
      allowPublic: networkPolicySource.allowPublic ?? EMPTY_NETWORK_POLICY.allowPublic,
      allowPrivate: networkPolicySource.allowPrivate ?? EMPTY_NETWORK_POLICY.allowPrivate,
      allowLoopback: networkPolicySource.allowLoopback ?? EMPTY_NETWORK_POLICY.allowLoopback,
      allowLinkLocal: networkPolicySource.allowLinkLocal ?? EMPTY_NETWORK_POLICY.allowLinkLocal,
      allowCGNAT: networkPolicySource.allowCGNAT ?? EMPTY_NETWORK_POLICY.allowCGNAT,
      allowIPv6ULA: networkPolicySource.allowIPv6ULA ?? EMPTY_NETWORK_POLICY.allowIPv6ULA,
      allowedCidrs: Object.freeze([...(networkPolicySource.allowedCidrs ?? [])]),
      deniedCidrs: Object.freeze([...(networkPolicySource.deniedCidrs ?? [])]),
    }),
    redirects: Object.freeze({
      mode: redirects.mode ?? 'same-origin',
      maxRedirects: redirects.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      allowedOrigins: Object.freeze([...(redirects.allowedOrigins ?? [])]),
    }),
    limits: Object.freeze(resolveLimits(globalLimits, rule.limits)),
  }
}

/**
 * Apply defaults and validation. Rules failing validation are DROPPED and
 * reported through `configErrors` — an invalid rule must never half-apply.
 */
export function resolveConfig(config: WebFetchAuthConfig = {}): ResolvedConfig {
  const globalLimits = config.limits
  const rules: ResolvedRule[] = []
  const configErrors: string[] = []
  const perRuleErrors = groupRuleErrors(config.rules ?? [])
  for (const [index, rule] of (config.rules ?? []).entries()) {
    const ruleErrors = perRuleErrors.get(index) ?? []
    if (ruleErrors.length > 0) {
      configErrors.push(...ruleErrors)
      continue
    }
    rules.push(resolveRule(rule, globalLimits))
  }
  return Object.freeze({
    configVersion: config.configVersion ?? 1,
    enabled: config.enabled ?? true,
    unmatchedPolicy: config.defaultPolicy?.unmatched ?? 'block',
    rules: Object.freeze(rules),
    limits: Object.freeze(resolveLimits(globalLimits, undefined)),
    audit: Object.freeze({ enabled: config.audit?.enabled ?? true }),
    configErrors: Object.freeze([...configErrors]),
  })
}

/** Run `validateRule` per rule and key the diagnostics by rule index. */
function groupRuleErrors(rules: readonly AuthenticatedFetchRule[]): Map<number, string[]> {
  const grouped = new Map<number, string[]>()
  for (const [index, rule] of rules.entries()) {
    const errors = validateRule(rule, index)
    if (errors.length > 0) grouped.set(index, errors)
  }
  return grouped
}
