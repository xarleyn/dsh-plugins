/**
 * Content-type classification and charset decoding for the authenticated
 * transport. `classifyContentType`, `parseCharset`, and `decoderForCharset`
 * are attributed copies of the upstream `@deepseek-ai/dsh-web-fetch-http`
 * policy helpers (SPEC §14, reuse option 3 — the upstream package publishes no
 * reusable API surface), so an authenticated response presents to
 * `dsh-tool-web` exactly like an anonymous one.
 * @module transport/charset
 */

/** The body kinds this provider decodes. */
export type FetchableKind = 'html' | 'text'

/**
 * Classify a response `Content-Type` into a decodable body kind, or `undefined`
 * for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
 * are `html`; other `text/*` plus a few structured text types are `text`.
 * @param contentType - the raw `Content-Type` header, or `null` when absent.
 */
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? '').replace(/;.*$/su, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

/**
 * Extract the `charset` parameter from a response `Content-Type`, lower-cased,
 * or `undefined` when absent.
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/iu.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/**
 * Build a `TextDecoder` for the declared charset, falling back to UTF-8 when
 * none is declared. Throws when the label is not one `TextDecoder` recognizes.
 */
export function decoderForCharset(charset: string | undefined): TextDecoder {
  if (charset === undefined) return new TextDecoder('utf-8')
  return new TextDecoder(charset)
}
