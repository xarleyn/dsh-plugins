/**
 * The authenticated fetch provider: a `WebFetchProvider` over `ctx.web` whose
 * internal rule router selects one configured rule per URL (SPEC §16). The
 * model-facing surface is exactly the upstream `web_fetch` tool — the provider
 * adds matching, policy, credentials, and audit invisibly.
 * @module provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type { PluginLogger } from '@yadsh/dsh-plugin-log'
import { resolveConfig, DEFAULT_MAX_URL_LENGTH, DEFAULT_USER_AGENT } from './config.js'
import type { WebFetchAuthConfig, ResolvedConfig, ResolvedRule } from './types.js'
import { matchRules } from './policy/match.js'
import { validateFetchUrl } from './policy/url.js'
import * as errors from './errors.js'
import { authenticatedFetch } from './transport/fetch.js'
import type { TransportGlobals } from './transport/fetch.js'
import { applyAdapter } from './adapters/index.js'
import type { AdapterRequestContext } from './adapters/index.js'
import type { CredentialResolver } from './credentials/resolver.js'
import type { ResolvedAuthSecrets } from './auth/index.js'

/** Stable id this provider registers under (SPEC §4). */
export const AUTHENTICATED_FETCH_PROVIDER_ID = 'authenticated'

/** Collaborators the provider needs at construction time. */
export interface ProviderDeps {
  /** Live config source (the settings-resolved section or the entry config). */
  readonly configSource: () => WebFetchAuthConfig
  readonly credentials: CredentialResolver
  readonly logger: PluginLogger
}

export class AuthenticatedFetchProvider implements WebFetchProvider {
  readonly id = AUTHENTICATED_FETCH_PROVIDER_ID

  private readonly deps: ProviderDeps

  constructor(deps: ProviderDeps) {
    this.deps = deps
  }

  /** The operational check the seam asks for: the plugin itself is enabled. */
  available(): boolean {
    // SPEC §13: per-rule misconfiguration surfaces at request time, not here.
    return this.resolved().enabled
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const config = this.resolved()
    if (!config.enabled) throw errors.ruleDisabled('provider')

    let url: URL
    try {
      url = validateFetchUrl(request.url, DEFAULT_MAX_URL_LENGTH)
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'InvalidUrlError') throw errors.invalidUrl(error.message)
      throw error
    }

    const matched = matchRules(config.rules, url)
    if (matched.length === 0) {
      this.auditDenied(url, 'AUTH_FETCH_NO_MATCHING_RULE', config.rules.length)
      throw errors.noMatchingRule(request.url, config.rules.length)
    }
    if (matched.length > 1) {
      this.auditDenied(url, 'AUTH_FETCH_AMBIGUOUS_MATCH', config.rules.length)
      throw errors.ambiguousMatch(request.url, matched.map(rule => rule.source.id))
    }
    const rule = matched[0]
    if (rule === undefined) throw errors.noMatchingRule(request.url, config.rules.length)

    const startedAt = Date.now()
    try {
      const adapterContext: AdapterRequestContext = {
        rule,
        rules: config.rules,
        globals: this.globals(),
        resolveSecrets: candidate => this.resolveSecrets(candidate),
        ...(signal === undefined ? {} : { signal }),
      }
      // A rule with a content adapter serves recognized URLs from the product
      // REST API and normalizes them; unrecognized URLs fall through to raw.
      const adapted = await applyAdapter(url, adapterContext)
      const result = adapted ?? await authenticatedFetch({ url, ...adapterContext })
      this.auditOk(rule, url, Date.now() - startedAt, result.statusCode)
      return result
    } catch (error: unknown) {
      const code = error instanceof WebError && typeof error.code === 'string' ? error.code : 'AUTH_FETCH_PROVIDER_ERROR'
      this.audit(rule, url, code, Date.now() - startedAt, undefined)
      throw error
    }
  }

  /** Resolve the credential VALUES for one rule's auth; never cached across fetches. */
  private async resolveSecrets(rule: ResolvedRule): Promise<ResolvedAuthSecrets> {
    const auth = rule.source.auth
    if (auth.type === 'none') return {}
    if (auth.type === 'basic') {
      return { password: await this.resolveOne(auth.passwordCredential, rule.source.id) }
    }
    return { credential: await this.resolveOne(auth.credential, rule.source.id) }
  }

  private resolveOne(ref: string, ruleId: string): Promise<string> {
    if (!isCredentialRefName(ref)) return Promise.reject(errors.credentialInvalid(ref, ruleId))
    return this.deps.credentials.resolve(ref).then(value => {
      if (value === undefined) throw errors.credentialMissing(ref, ruleId)
      return value
    })
  }

  private resolved(): ResolvedConfig {
    return resolveConfig(this.deps.configSource())
  }

  private globals(): TransportGlobals {
    return {
      maxUrlLength: DEFAULT_MAX_URL_LENGTH,
      userAgent: DEFAULT_USER_AGENT,
    }
  }

  private auditDenied(url: URL, outcome: string, ruleCount: number): void {
    if (!this.resolved().audit.enabled) return
    this.deps.logger.info('auth_fetch.denied', {
      outcome,
      origin: url.origin,
      path: url.pathname,
      rules: ruleCount,
    })
  }

  private auditOk(rule: ResolvedRule, url: URL, durationMs: number, statusCode: number): void {
    this.audit(rule, url, 'ok', durationMs, statusCode)
  }

  private audit(rule: ResolvedRule, url: URL, outcome: string, durationMs: number, statusCode: number | undefined): void {
    if (!this.resolved().audit.enabled) return
    this.deps.logger.info('auth_fetch.request', {
      ruleId: rule.source.id,
      origin: url.origin,
      path: url.pathname,
      outcome,
      durationMs,
      ...(statusCode === undefined ? {} : { statusCode }),
    })
  }
}
