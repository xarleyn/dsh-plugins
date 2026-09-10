/**
 * Configuration and report vocabulary of `dsh-web-fetch-authenticated`.
 * Pure types only: this module is imported by the Host, by the browser client
 * bundle, and by the generated Typert face, so it must stay free of Node or
 * DOM dependencies.
 * @module types
 */

/** Network destination classes the SSRF policy distinguishes (SPEC §10.1). */
export type NetworkClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'cgnat'
  | 'ipv6ULA'
  | 'linkLocal'
  | 'ipv6LinkLocal'
  | 'metadata'
  | 'multicast'
  | 'unspecified'
  | 'reserved'
  | 'broadcast'

/** Per-rule network access policy (SPEC §10). Defaults are restrictive. */
export interface NetworkPolicy {
  /** Allow globally routable public addresses. Default `true`. */
  allowPublic?: boolean
  /** Allow RFC1918 private ranges (10/8, 172.16/12, 192.168/16). Default `false`. */
  allowPrivate?: boolean
  /** Allow loopback (127/8, ::1, localhost). Default `false`. */
  allowLoopback?: boolean
  /** Allow IPv4 link-local (169.254/16) and IPv6 link-local (fe80::/10). Default `false`. */
  allowLinkLocal?: boolean
  /** Allow carrier-grade NAT (100.64/10). Default `false`. */
  allowCGNAT?: boolean
  /** Allow IPv6 unique-local addresses (fc00::/7). Default `false`. */
  allowIPv6ULA?: boolean
  /**
   * Addresses inside these CIDRs are allowed regardless of their class
   * (except always-denied classes). Narrow CIDRs are preferred over
   * `allowPrivate`.
   */
  allowedCidrs?: string[]
  /** Addresses inside these CIDRs are denied even when `allowedCidrs` matches. */
  deniedCidrs?: string[]
}

/** How redirects are followed (SPEC §10.5). */
export type RedirectMode = 'none' | 'same-origin' | 'allowlist'

export interface RedirectPolicy {
  /** Default `same-origin`. */
  mode?: RedirectMode
  /** Default `3`. `0` follows no redirects. */
  maxRedirects?: number
  /** Extra origins `mode: 'allowlist'` may redirect to. */
  allowedOrigins?: string[]
}

/** Response limits; rule values override the global defaults. */
export interface FetchLimits {
  /** Per-request timeout in milliseconds. Default `30000`. */
  timeoutMs?: number
  /** Maximum response body size in bytes. Default `5242880`. */
  maxResponseBytes?: number
  /** Maximum decoded body length in characters. Default `100000`. */
  maxBodyChars?: number
}

/** Discriminant of the supported authentication types (SPEC §8, v1 set). */
export type AuthType = 'none' | 'bearer' | 'basic' | 'header'

/**
 * Authentication attached to matched requests. `credential` fields hold a
 * DSH credential REFERENCE (an env-var-style name), never a secret value.
 */
export type AuthConfig =
  | { readonly type: 'none' }
  | { readonly type: 'bearer'; readonly credential: string }
  | { readonly type: 'basic'; readonly username: string; readonly passwordCredential: string }
  | { readonly type: 'header'; readonly headerName: string; readonly credential: string; readonly prefix?: string }

/** Match section of a rule (SPEC §7/§9): exact hosts, glob paths. */
export interface RuleMatch {
  /** Default `['https']`. */
  schemes?: Array<'https' | 'http'>
  /** Exact hostnames (lowercase; wildcards are rejected in v1). */
  hosts: string[]
  /** Allowed ports; omitted = any port (default ports included). */
  ports?: number[]
  /** Glob path patterns; omitted = every path on the matched origin. */
  allowPaths?: string[]
  /** Glob path patterns subtracted from the allow set. */
  denyPaths?: string[]
}

/** One authenticated-origin rule (SPEC §7). */
export interface AuthenticatedFetchRule {
  /** Stable id, independent of the display name (SPEC §28). */
  id: string
  name: string
  description?: string
  enabled: boolean
  /** Optional default URL used by the connection tester. */
  testUrl?: string
  match: RuleMatch
  auth: AuthConfig
  networkPolicy?: NetworkPolicy
  redirects?: RedirectPolicy
  limits?: FetchLimits
}

/** What happens when no rule matches (SPEC §17). v1 supports `block` only. */
export type UnmatchedPolicy = 'block'

export interface DefaultPolicy {
  unmatched?: UnmatchedPolicy
}

export interface AuditConfig {
  /** Emit sanitized audit records through the shared plugin logger. Default `true`. */
  enabled?: boolean
}

/** Plugin configuration (SPEC §7/§23). */
export interface WebFetchAuthConfig {
  configVersion?: number
  enabled?: boolean
  rules?: AuthenticatedFetchRule[]
  defaultPolicy?: DefaultPolicy
  /** Global limit defaults applied to every rule. */
  limits?: FetchLimits
  audit?: AuditConfig
}

/** Fully resolved configuration after defaults are applied. */
export interface ResolvedNetworkPolicy {
  allowPublic: boolean
  allowPrivate: boolean
  allowLoopback: boolean
  allowLinkLocal: boolean
  allowCGNAT: boolean
  allowIPv6ULA: boolean
  allowedCidrs: readonly string[]
  deniedCidrs: readonly string[]
}

export interface ResolvedRedirectPolicy {
  mode: RedirectMode
  maxRedirects: number
  allowedOrigins: readonly string[]
}

export interface ResolvedLimits {
  timeoutMs: number
  maxResponseBytes: number
  maxBodyChars: number
}

export interface ResolvedRule {
  readonly source: AuthenticatedFetchRule
  readonly networkPolicy: ResolvedNetworkPolicy
  readonly redirects: ResolvedRedirectPolicy
  readonly limits: ResolvedLimits
}

export interface ResolvedConfig {
  readonly configVersion: number
  readonly enabled: boolean
  readonly unmatchedPolicy: UnmatchedPolicy
  readonly rules: readonly ResolvedRule[]
  readonly limits: ResolvedLimits
  readonly audit: Required<AuditConfig>
  /** Rules dropped because they failed validation, with the reasons. */
  readonly configErrors: readonly string[]
}

// ---- Sanitized remote reports (the only shapes crossing the Typert wire) ----

/** A single DNS answer, classified. Values are safe: addresses and classes only. */
export interface AddressView {
  readonly address: string
  readonly family: 4 | 6
  readonly networkClass: NetworkClass
  readonly allowed: boolean
}

/** Why a URL did or did not match a rule; contains no secret material. */
export interface MatchView {
  readonly ruleId?: string
  readonly ruleName?: string
  readonly reason: string
}

/** Credential facts for a reference, safe for UI display (SPEC §21). */
export interface CredentialStateView {
  readonly ref: string
  readonly configured: boolean
  readonly writable: boolean
  readonly validName: boolean
}

/** Sanitized result of the rule connection tester (SPEC §6.3). */
export interface RuleTestReport {
  readonly ok: boolean
  readonly ruleId: string
  readonly ruleName: string
  readonly url: string
  readonly startedAt: number
  readonly durationMs: number
  readonly matchedRule: boolean
  readonly networkAllowed: boolean
  readonly addresses: readonly AddressView[]
  readonly finalOrigin?: string
  readonly statusCode?: number
  readonly contentType?: string
  readonly responseBytes?: number
  readonly redirectCount: number
  /** Whether authentication headers were attached; never their values. */
  readonly authApplied: boolean
  readonly credentialState?: CredentialStateView
  /** Outcome label: `ok` or the failing error code. */
  readonly outcome: string
  /** Human-safe detail; secret-scrubbed. */
  readonly detail?: string
  /** Short secret-scrubbed response preview. */
  readonly preview?: string
  readonly truncated: boolean
}

/** Sanitized match/policy diagnosis without performing the HTTP request (SPEC §6.4). */
export interface DiagnoseReport {
  readonly url: string
  readonly validUrl: boolean
  readonly detail?: string
  readonly match: MatchView
  readonly networkAllowed: boolean
  readonly addresses: readonly AddressView[]
  readonly redirectPolicy: string
  readonly credentialState?: CredentialStateView
}

/** Provider status projection for the settings card (SPEC §6.1). */
export interface ProviderStatusReport {
  readonly enabled: boolean
  readonly registered: boolean
  readonly available: boolean
  /** Configured `ctx.web` fetch provider id when it can be observed. */
  readonly fetchProviderId?: string
  readonly ruleCount: number
  readonly enabledRuleCount: number
  readonly credentialStates: readonly CredentialStateView[]
  readonly configErrors: readonly string[]
  readonly lastTests: readonly RuleTestReport[]
  readonly unmatchedPolicy: UnmatchedPolicy
}

/** Where per-rule last-test results come from in {@link ProviderStatusReport}. */
export type LastTestEntry = RuleTestReport
