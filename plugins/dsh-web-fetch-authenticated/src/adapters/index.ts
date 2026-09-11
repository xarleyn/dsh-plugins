/**
 * Content adapter application seam (SPEC §15.2/§16): one entry point the
 * provider and the tester call after a rule matched. An adapter rewrites the
 * recognized URL to the product's REST API and fetches it through the SAME
 * `authenticatedFetch` transport — network policy, DNS pinning, credentials,
 * redirects, and byte/char limits all apply to the REST hop unchanged; only
 * the presentation differs. An adapter that cannot map the URL falls through
 * (`undefined`), leaving the raw HTTP/HTML behavior untouched.
 * @module adapters
 */

import type { WebFetchResult } from '@deepseek-ai/dsh-web'
import type { ResolvedAdapter, ResolvedRule } from '../types.js'
import { authenticatedFetch } from '../transport/fetch.js'
import type { SecretResolver, TransportGlobals } from '../transport/fetch.js'
import * as errors from '../errors.js'
import { fetchIssueMarkdown } from './jira.js'
import { fetchPageMarkdown } from './confluence.js'

/** Everything an adapter run needs; mirrors the transport options minus metrics. */
export interface AdapterRequestContext {
  readonly rule: ResolvedRule
  readonly rules: readonly ResolvedRule[]
  readonly globals: TransportGlobals
  readonly resolveSecrets: SecretResolver
  readonly signal?: AbortSignal
}

/** The transport call adapters use for their REST hops (injectable for tests). */
export type TransportFetch = (url: URL, context: AdapterRequestContext) => Promise<WebFetchResult>

/**
 * Apply the rule's content adapter to a validated request URL. Returns the
 * normalized result, or `undefined` when the rule has no adapter or the URL
 * is not one the adapter recognizes (callers fall through to raw transport).
 */
export async function applyAdapter(url: URL, context: AdapterRequestContext, fetchImpl: TransportFetch = (restUrl, restContext) => authenticatedFetch({ url: restUrl, ...restContext })): Promise<WebFetchResult | undefined> {
  const adapter = context.rule.adapter
  if (adapter.type === 'none') return undefined
  if (!adapterApplies(adapter, url)) return undefined

  const fetchJson = async (restUrl: URL): Promise<{ statusCode: number; data: unknown }> => {
    const result = await fetchImpl(restUrl, context)
    if (!isJsonBody(result.body.kind)) {
      throw errors.adapterFailed(`the REST endpoint ${restUrl.pathname} did not return JSON (content was ${result.body.kind})`)
    }
    try {
      return { statusCode: result.statusCode, data: JSON.parse(result.body.content) as unknown }
    } catch (cause) {
      throw errors.adapterFailed(`the REST endpoint ${restUrl.pathname} returned malformed JSON`, cause)
    }
  }

  const { statusCode, markdown } = adapter.type === 'jira'
    ? await fetchIssueMarkdown(url, adapter, fetchJson)
    : await fetchPageMarkdown(url, adapter, fetchJson)

  // The REST hop already passed through the transport's byte cap; cap the
  // generated text by the same char limit so a huge issue stays bounded.
  const maxChars = context.rule.limits.maxBodyChars
  const truncated = markdown.length > maxChars
  const content = truncated ? markdown.slice(0, maxChars) : markdown
  return {
    url: url.toString(),
    statusCode,
    body: { kind: 'text', content },
    truncated,
  }
}

/** Whether the adapter recognizes this URL shape (unrecognized → fall through). */
function adapterApplies(adapter: ResolvedAdapter, url: URL): boolean {
  if (adapter.type === 'jira') {
    // Jira: /browse/<KEY> at any deployment depth and /issues/<KEY>.
    return /(?:^|\/)(?:browse|issues)\/[A-Z][A-Z0-9]*-\d+$/iu.test(url.pathname)
  }
  // Confluence: any `/pages/<digits>/...` or `/display/<SPACE>/<title>` path.
  return /(?:^|\/)(?:pages\/\d+|display\/[^/]+\/\S)/iu.test(url.pathname)
}

function isJsonBody(kind: 'html' | 'text'): boolean {
  return kind === 'text'
}
