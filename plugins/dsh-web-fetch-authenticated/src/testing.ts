/**
 * Sanitized tester/diagnostics engine (SPEC §6.3/§6.4): the only producer of
 * the report shapes the Typert remote ships to the browser. Every field is
 * chosen for disclosure — no headers, no credential values, previews are
 * secret-scrubbed (invariant 7/8).
 * @module testing
 */

import type {
  AddressView,
  CredentialStateView,
  DiagnoseReport,
  MatchView,
  ResolvedRule,
  RuleTestReport,
  WebFetchAuthConfig,
} from './types.js'
import { resolveConfig, DEFAULT_MAX_URL_LENGTH } from './config.js'
import { matchRules } from './policy/match.js'
import { validateFetchUrl } from './policy/url.js'
import { AddressPolicyDeniedError, resolveApprovedAddresses } from './policy/dns.js'
import type { CredentialResolver } from './credentials/resolver.js'
import { authenticatedFetch } from './transport/fetch.js'
import type { FetchMetrics } from './transport/fetch.js'
import { applyAdapter } from './adapters/index.js'
import { primaryCredentialRef, requiredCredentialRefs } from './auth/index.js'
import { sanitizePreview } from './audit/redact.js'
import * as errors from './errors.js'

/** Collaborators the tester shares with the provider. */
export interface TesterDeps {
  readonly configSource: () => WebFetchAuthConfig
  readonly credentials: CredentialResolver
}

/** Preview length of the tester's sanitized response snippet. */
const PREVIEW_CHARS = 400

async function credentialState(credentials: CredentialResolver, rule: ResolvedRule): Promise<CredentialStateView | undefined> {
  const ref = requiredCredentialRefs(rule.source.auth)[0]
  if (ref === undefined) return undefined
  const validName = /^[A-Za-z_][A-Za-z0-9_]*$/u.test(ref)
  const described = await credentials.describe(ref).catch(() => undefined)
  const configured = described?.configured === true
    ? true
    : await credentials.resolve(ref).then(value => value !== undefined).catch(() => false)
  return { ref, configured, writable: described?.writable ?? true, validName }
}

function credentialStateFields(view: CredentialStateView | undefined): { credentialState?: CredentialStateView } {
  return view === undefined ? {} : { credentialState: view }
}

function detailField(detail: string | undefined): { detail?: string } {
  return detail === undefined ? {} : { detail }
}

/** Resolve + classify DNS for a URL without the failure being fatal. */
async function classifyDns(url: URL, rule: ResolvedRule): Promise<{ addresses: readonly AddressView[]; allowed: boolean; detail?: string }> {
  try {
    const { verdicts } = await resolveApprovedAddresses(url.hostname, rule.networkPolicy)
    return {
      addresses: verdicts.map(verdict => ({
        address: verdict.address,
        family: verdict.family,
        networkClass: verdict.networkClass,
        allowed: verdict.allowed,
      })),
      allowed: true,
    }
  } catch (error: unknown) {
    if (error instanceof AddressPolicyDeniedError) {
      return {
        addresses: error.verdicts.map(verdict => ({
          address: verdict.address,
          family: verdict.family,
          networkClass: verdict.networkClass,
          allowed: verdict.allowed,
        })),
        allowed: false,
        detail: errors.sanitizedDetail(error),
      }
    }
    return { addresses: [], allowed: false, detail: errors.sanitizedDetail(error) }
  }
}

/** Run one connection test for one rule (SPEC §6.3). */
export async function testRule(deps: TesterDeps, ruleId: string, requestedUrl?: string): Promise<RuleTestReport> {
  const config = resolveConfig(deps.configSource())
  const startedAt = Date.now()
  const elapsed = (): number => Date.now() - startedAt
  const base: RuleTestReport = {
    ok: false,
    ruleId,
    ruleName: ruleId,
    url: requestedUrl ?? '',
    startedAt,
    durationMs: 0,
    matchedRule: false,
    networkAllowed: false,
    addresses: [],
    redirectCount: 0,
    authApplied: false,
    outcome: 'AUTH_FETCH_NO_MATCHING_RULE',
    truncated: false,
  }

  const rule = config.rules.find(candidate => candidate.source.id === ruleId)
  if (rule === undefined || rule.source.enabled === false) {
    return { ...base, outcome: 'AUTH_FETCH_RULE_DISABLED', detail: 'the rule is disabled or missing', durationMs: elapsed() }
  }
  const urlText = requestedUrl !== undefined && requestedUrl.length > 0 ? requestedUrl : rule.source.testUrl ?? ''
  let url: URL
  try {
    url = validateFetchUrl(urlText, DEFAULT_MAX_URL_LENGTH)
  } catch (error: unknown) {
    return {
      ...base,
      outcome: 'AUTH_FETCH_INVALID_URL',
      url: urlText,
      detail: error instanceof Error ? error.message : 'invalid URL',
      durationMs: elapsed(),
    }
  }

  const matched = matchRules(config.rules, url)
  const matchedThis = matched.some(candidate => candidate.source.id === ruleId)
  const metrics: FetchMetrics = {}
  const credentialStateView = await credentialState(deps.credentials, rule)
  const dns = await classifyDns(url, rule)

  if (!matchedThis) {
    return {
      ...base,
      url: url.toString(),
      ruleName: rule.source.name,
      networkAllowed: dns.allowed,
      addresses: dns.addresses,
      ...credentialStateFields(credentialStateView),
      outcome: 'AUTH_FETCH_NO_MATCHING_RULE',
      detail: 'the URL does not match this rule (check hosts, ports, schemes, and path patterns)',
      durationMs: elapsed(),
    }
  }
  if (!dns.allowed) {
    return {
      ...base,
      url: url.toString(),
      ruleName: rule.source.name,
      matchedRule: true,
      networkAllowed: false,
      addresses: dns.addresses,
      ...credentialStateFields(credentialStateView),
      outcome: 'AUTH_FETCH_NETWORK_DENIED',
      ...detailField(dns.detail),
      durationMs: elapsed(),
    }
  }

  try {
    const adapterContext = {
      rule,
      rules: config.rules,
      globals: { maxUrlLength: DEFAULT_MAX_URL_LENGTH, userAgent: testerUserAgent() },
      resolveSecrets: async () => {
        // The transport builds headers from these values; they never leave
        // this closure. Missing credentials reject with the seam error.
        const auth = rule.source.auth
        if (auth.type === 'none') return {}
        const ref = primaryCredentialRef(auth)
        if (ref === undefined) return {}
        const value = await deps.credentials.resolve(ref)
        if (value === undefined) throw errors.credentialMissing(ref, ruleId)
        if (auth.type === 'basic') return { password: value }
        return { credential: value }
      },
    }
    // Same adapter seam as the live provider: Test shows the normalized text.
    const result = await (await applyAdapter(url, adapterContext)) ?? await authenticatedFetch({ url, ...adapterContext, onMetrics: update => {
      Object.assign(metrics, update)
    } })
    return {
      ...base,
      ok: true,
      url: url.toString(),
      ruleName: rule.source.name,
      matchedRule: true,
      networkAllowed: true,
      addresses: dns.addresses,
      finalOrigin: new URL(result.url).origin,
      statusCode: result.statusCode,
      ...(metrics.contentType === undefined ? {} : { contentType: metrics.contentType }),
      ...(metrics.responseBytes === undefined ? {} : { responseBytes: metrics.responseBytes }),
      redirectCount: metrics.redirectCount ?? 0,
      authApplied: rule.source.auth.type !== 'none',
      ...credentialStateFields(credentialStateView),
      ...(rule.adapter.type === 'none' ? {} : { adapter: rule.adapter.type }),
      outcome: 'ok',
      preview: sanitizePreview(result.body.content, PREVIEW_CHARS),
      truncated: result.truncated,
      durationMs: elapsed(),
    }
  } catch (error: unknown) {
    const detail = errors.sanitizedDetail(error)
    const outcome = detail.includes('credential') && credentialStateView?.configured === false
      ? 'AUTH_FETCH_CREDENTIAL_MISSING'
      : outcomeFromDetail(detail)
    return {
      ...base,
      url: url.toString(),
      ruleName: rule.source.name,
      matchedRule: true,
      networkAllowed: true,
      addresses: dns.addresses,
      ...credentialStateFields(credentialStateView),
      authApplied: rule.source.auth.type !== 'none',
      outcome,
      detail,
      redirectCount: metrics.redirectCount ?? 0,
      durationMs: elapsed(),
    }
  }
}

/** Best-effort code extraction from a sanitized WebError message. */
function outcomeFromDetail(detail: string): string {
  const match = /AUTH_FETCH_[A-Z_]+/u.exec(detail)
  return match?.[0] ?? 'AUTH_FETCH_PROVIDER_ERROR'
}

function testerUserAgent(): string {
  return 'deepseek-harness-authenticated-fetch-test (+https://github.com/xarleyn/dsh-plugins)'
}

/** Diagnose a URL's match and policy verdicts without any HTTP request (SPEC §6.4). */
export async function diagnose(deps: TesterDeps, urlText: string): Promise<DiagnoseReport> {
  const config = resolveConfig(deps.configSource())
  let url: URL
  try {
    url = validateFetchUrl(urlText, DEFAULT_MAX_URL_LENGTH)
  } catch (error: unknown) {
    return {
      url: urlText,
      validUrl: false,
      detail: error instanceof Error ? error.message : 'invalid URL',
      match: { reason: 'URL is invalid' },
      networkAllowed: false,
      addresses: [],
      redirectPolicy: '',
    }
  }
  const matched = matchRules(config.rules, url)
  const match: MatchView = matched.length === 0
    ? { reason: `no enabled rule matches (${config.rules.length} configured)` }
    : matched.length > 1
      ? { reason: `ambiguous match: ${matched.map(rule => rule.source.id).join(', ')}` }
      : matched[0] === undefined
        ? { reason: 'match evaluation failed' }
        : { ruleId: matched[0].source.id, ruleName: matched[0].source.name, reason: 'matched' }
  const rule = matched[0]
  if (rule === undefined) {
    return {
      url: url.toString(),
      validUrl: true,
      match,
      networkAllowed: false,
      addresses: [],
      redirectPolicy: '',
    }
  }
  const dns = await classifyDns(url, rule)
  const credentialStateView = await credentialState(deps.credentials, rule)
  return {
    url: url.toString(),
    validUrl: true,
    ...detailField(dns.detail),
    match,
    networkAllowed: dns.allowed,
    addresses: dns.addresses,
    redirectPolicy: `${rule.redirects.mode} (max ${rule.redirects.maxRedirects})`,
    ...credentialStateFields(credentialStateView),
  }
}
