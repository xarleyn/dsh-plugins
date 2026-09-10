/**
 * The authenticated transport (SPEC §5.1/§14): per hop — validate the URL,
 * re-match the rule, resolve and policy-check DNS, THEN resolve credentials
 * and attach auth, request, and enforce redirect policy. Timeout, abort, byte
 * caps, content classification, and decoding mirror the upstream anonymous
 * provider's semantics so `dsh-tool-web` sees the same result shape.
 *
 * Transport runs on `node:http`/`node:https` (not global `fetch`) so the
 * socket connects to exactly the addresses the policy approved — see
 * INVESTIGATE.md §7.
 * @module transport/fetch
 */

import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { WebFetchResult } from '@deepseek-ai/dsh-web'
import {
  AddressPolicyDeniedError,
  AddressResolutionError,
  pinnedLookup,
  resolveApprovedAddresses,
} from '../policy/dns.js'
import type { ApprovedAddress, HostnameResolver } from '../policy/dns.js'
import { decideRedirect } from '../policy/redirect.js'
import { matchRules, ruleMatchesUrl } from '../policy/match.js'
import { validateFetchUrl } from '../policy/url.js'
import { InvalidUrlError } from '../policy/url.js'
import type { ResolvedRule } from '../types.js'
import * as errors from '../errors.js'
import { buildAuthHeaders, type ResolvedAuthSecrets } from '../auth/index.js'
import { classifyContentType, decoderForCharset, parseCharset } from './charset.js'

/** Protocol-level settings shared by every rule (SPEC §23). */
export interface TransportGlobals {
  readonly maxUrlLength: number
  readonly userAgent: string
}

/** Credential resolution hook: per-fetch, per-rule; returns secret values. */
export type SecretResolver = (rule: ResolvedRule) => Promise<ResolvedAuthSecrets>

/** Sanitized pipeline facts the tester consumes; no header or body content. */
export interface FetchMetrics {
  responseBytes?: number
  redirectCount?: number
  contentType?: string
  statusCode?: number
  finalUrl?: string
}

/** Options of one authenticated fetch pipeline run. */
export interface AuthenticatedFetchOptions {
  /** The validated request URL. */
  readonly url: URL
  /** The rule that matched the URL (already resolved). */
  readonly rule: ResolvedRule
  /** All enabled resolved rules, for redirect re-matching. */
  readonly rules: readonly ResolvedRule[]
  readonly globals: TransportGlobals
  readonly resolveSecrets: SecretResolver
  readonly signal?: AbortSignal
  /** Observes each followed redirect hop (audit). */
  readonly onRedirect?: (from: URL, to: URL) => void
  /** Observes sanitized completion facts (tester reports). */
  readonly onMetrics?: (metrics: FetchMetrics) => void
  /** DNS resolver override (tests); defaults to the OS resolver. */
  readonly resolveAddresses?: HostnameResolver
}

/** Redirect statuses that carry a `Location` (upstream parity). */
function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

const keepAlivelessHttpAgent = new http.Agent({ keepAlive: false })
const keepAlivelessHttpsAgent = new https.Agent({ keepAlive: false })

/**
 * Run the authenticated fetch pipeline to completion. Throws only `WebError`s.
 * The returned result follows the seam contract: a fetched non-2xx response is
 * a result, not a throw.
 */
export async function authenticatedFetch(options: AuthenticatedFetchOptions): Promise<WebFetchResult> {
  if (options.signal?.aborted) return Promise.reject(errors.aborted())

  // Fuse caller cancellation with the rule's timeout. AbortSignal.timeout
  // aborts with a `TimeoutError` reason, which translateTransportError maps to
  // AUTH_FETCH_TIMEOUT; any other abort is the caller's cancellation.
  const timeoutSignal = AbortSignal.timeout(options.rule.limits.timeoutMs)
  const signal = options.signal === undefined
    ? timeoutSignal
    : AbortSignal.any([options.signal, timeoutSignal])
  const outerAborted = (): boolean => options.signal?.aborted === true

  let currentUrl = options.url
  let currentRule = options.rule
  let redirectsFollowed = 0
  // Credentials resolve once per fetch operation per rule (SPEC §12): the same
  // operation reuses them across same-rule redirect hops; a hop that switches
  // rules resolves the new rule's references before any auth is built.
  const secretCache = new Map<string, ResolvedAuthSecrets>()

  for (;;) {
    // Network approval happens BEFORE any credential work (invariant 3).
    let approved: readonly ApprovedAddress[]
    try {
      approved = (await resolveApprovedAddresses(currentUrl.hostname, currentRule.networkPolicy, options.resolveAddresses)).approved
    } catch (error: unknown) {
      if (error instanceof AddressPolicyDeniedError) throw errors.networkDenied(errors.sanitizedDetail(error))
      if (error instanceof AddressResolutionError) throw errors.dnsResolutionFailed(errors.sanitizedDetail(error))
      throw errors.providerError(errors.sanitizedDetail(error), error)
    }

    let secrets = secretCache.get(currentRule.source.id)
    if (secrets === undefined) {
      secrets = await options.resolveSecrets(currentRule)
      secretCache.set(currentRule.source.id, secrets)
    }
    let authHeaders: Record<string, string>
    try {
      authHeaders = buildAuthHeaders(currentRule, secrets) ?? {}
    } catch (error: unknown) {
      throw errors.credentialMissing(errors.sanitizedDetail(error), currentRule.source.id)
    }

    const response = await requestOnce(currentUrl, {
      'user-agent': options.globals.userAgent,
      'accept': 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8',
      ...authHeaders,
    }, approved, signal, outerAborted)

    if (isRedirectStatus(response.statusCode ?? 0)) {
      const location = response.headers.location
      const status = response.statusCode ?? 0
      if (location === undefined || Array.isArray(location)) {
        consume(response)
        throw errors.redirectDenied(`redirect response (HTTP ${status}) without a usable Location header`)
      }
      if (redirectsFollowed >= currentRule.redirects.maxRedirects) {
        consume(response)
        throw errors.redirectDenied(
          `exceeded the maximum of ${currentRule.redirects.maxRedirects} redirects`,
        )
      }
      let target: URL
      try {
        target = validateFetchUrl(new URL(location, currentUrl).toString(), options.globals.maxUrlLength)
      } catch (error: unknown) {
        consume(response)
        if (error instanceof InvalidUrlError) throw errors.redirectDenied(`redirect target is invalid: ${error.message}`)
        throw error
      }
      const sameRule = ruleMatchesUrl(currentRule.source, target)
      const someRule = matchRules(options.rules, target)
      const decision = decideRedirect(currentRule.redirects, currentUrl, target, sameRule, someRule.length > 0)
      if (decision.action === 'deny') {
        consume(response)
        throw errors.redirectDenied(decision.reason)
      }
      options.onRedirect?.(currentUrl, target)
      consume(response)
      if (!decision.sameRule) {
        const nextRule = someRule[0]
        if (nextRule !== undefined) currentRule = nextRule
      }
      currentUrl = target
      redirectsFollowed += 1
      continue
    }

    options.onMetrics?.({ redirectCount: redirectsFollowed })
    return await readBody(response, currentUrl, currentRule.limits.maxResponseBytes, currentRule.limits.maxBodyChars, signal, options.onMetrics)
  }
}

/** Issue one GET against `url`, pinned to `approved`, and resolve on headers. */
async function requestOnce(url: URL, headers: Record<string, string>, approved: readonly ApprovedAddress[], signal: AbortSignal, outerAborted: () => boolean): Promise<IncomingMessage> {
  const isHttps = url.protocol === 'https:'
  const transport = isHttps ? https : http
  return await new Promise<IncomingMessage>((resolve, reject) => {
    const request = transport.request(url, {
      method: 'GET',
      headers,
      agent: isHttps ? keepAlivelessHttpsAgent : keepAlivelessHttpAgent,
      // The connection may only use addresses the policy approved; SNI and
      // certificate identity stay the hostname the rule matched.
      lookup: pinnedLookup(approved),
      ...(isHttps ? { servername: url.hostname } : {}),
      signal,
    }, resolve)
    request.on('error', reject)
    request.end()
  }).catch((error: unknown) => {
    throw translateTransportError(error, signal, outerAborted)
  })
}

/** Classify a thrown transport value against the fused signal (upstream parity). */
function translateTransportError(error: unknown, signal: AbortSignal, outerAborted: () => boolean): Error {
  if (!outerAborted()) {
    const reason: unknown = (signal as { reason?: unknown }).reason
    if (reason instanceof Error && reason.name === 'TimeoutError') return errors.timeout()
  }
  if (signal.aborted) return errors.aborted(error)
  return errors.providerError(errors.sanitizedDetail(error), error)
}

/** Drain and close a response we are not going to read, so no socket leaks. */
function consume(response: IncomingMessage): void {
  response.destroy()
}

/** Read, byte-cap, classify, and decode the final response body. */
async function readBody(
  response: IncomingMessage,
  finalUrl: URL,
  maxResponseBytes: number,
  maxBodyChars: number,
  signal: AbortSignal,
  onMetrics?: (metrics: FetchMetrics) => void,
): Promise<WebFetchResult> {
  const contentType = response.headers['content-type'] ?? null
  const kind = classifyContentType(contentType)
  if (kind === undefined) {
    consume(response)
    throw errors.unsupportedContent(contentType)
  }
  let decoder: TextDecoder
  try {
    decoder = decoderForCharset(parseCharset(contentType))
  } catch {
    consume(response)
    throw errors.unsupportedCharset(parseCharset(contentType) ?? 'unknown')
  }

  const { bytes, truncatedByBytes } = await readCapped(response, maxResponseBytes, signal)
  const decoded = decoder.decode(bytes)
  const truncatedByChars = decoded.length > maxBodyChars
  const content = truncatedByChars ? decoded.slice(0, maxBodyChars) : decoded
  const body = kind === 'html' ? ({ kind: 'html', content } as const) : ({ kind: 'text', content } as const)
  onMetrics?.({
    responseBytes: bytes.byteLength,
    ...(contentType === null ? {} : { contentType }),
    ...(response.statusCode === undefined ? {} : { statusCode: response.statusCode }),
    finalUrl: finalUrl.toString(),
  })
  return {
    url: finalUrl.toString(),
    statusCode: response.statusCode ?? 0,
    body,
    truncated: truncatedByBytes || truncatedByChars,
  }
}

/**
 * Read the response stream up to `maxResponseBytes`. An over-cap
 * `Content-Length` rejects immediately; a stream growing past the cap is cut
 * short (`truncatedByBytes`) so an under-reporting server still yields a
 * bounded body.
 */
async function readCapped(response: IncomingMessage, maxResponseBytes: number, signal: AbortSignal): Promise<{
  bytes: Uint8Array
  truncatedByBytes: boolean
}> {
  const declared = response.headers['content-length']
  if (declared !== undefined) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > maxResponseBytes) {
      consume(response)
      throw errors.responseTooLarge(maxResponseBytes)
    }
  }
  if (response.readable === false) return { bytes: new Uint8Array(0), truncatedByBytes: false }

  const chunks: Buffer[] = []
  let total = 0
  let truncatedByBytes = false
  let abortListener: (() => void) | undefined
  const failure = new Promise<never>((_resolve, reject) => {
    response.on('error', reject)
    const abort = (): void => {
      response.destroy()
      reject(new Error('response read aborted'))
    }
    abortListener = abort
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
  })

  const read = (async () => {
    for await (const chunk of response) {
      const buffer = chunk as Buffer
      const remaining = maxResponseBytes - total
      // Only DROPPED bytes count as truncation: an exactly-at-cap body is not
      // falsely flagged truncated (upstream parity).
      if (buffer.byteLength > remaining) {
        chunks.push(buffer.subarray(0, remaining))
        total += remaining
        truncatedByBytes = true
        break
      }
      chunks.push(buffer)
      total += buffer.byteLength
    }
  })()

  await Promise.race([read, failure]).finally(() => {
    if (abortListener !== undefined) signal.removeEventListener('abort', abortListener)
    response.destroy()
  })

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, truncatedByBytes }
}
