/**
 * URL hygiene for the authenticated fetch provider: scheme checks, embedded
 * credential rejection, length caps, and origin comparison. `validateFetchUrl`
 * and `isSameOrigin` are attributed copies of the upstream
 * `@deepseek-ai/dsh-web-fetch-http` policy helpers (SPEC §14, reuse option 3 —
 * the upstream package publishes no reusable API surface), extended with the
 * authenticated provider's own normalization helpers.
 * @module policy/url
 */

/** Upstream cap parity: the maximum accepted request URL length. */
export interface UrlValidationLimits {
  readonly maxUrlLength: number
}

export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidUrlError'
  }
}

/**
 * Validate a request URL before any network access or rule evaluation:
 * absolute, http(s), no embedded credentials, bounded length. Returns the
 * parsed `URL` (its `hostname` is already lower-cased punycode, the form the
 * rule matcher compares against). Throws {@link InvalidUrlError} otherwise.
 * @param input - the raw URL string.
 * @param maxUrlLength - inclusive upper bound on `input`'s length.
 * @returns the parsed `URL`.
 */
export function validateFetchUrl(input: string, maxUrlLength: number): URL {
  if (input.length > maxUrlLength) {
    throw new InvalidUrlError(`URL exceeds the maximum length of ${maxUrlLength}`)
  }
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new InvalidUrlError(`invalid URL: ${truncateForMessage(input)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidUrlError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`)
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new InvalidUrlError('credentials in URLs are not allowed')
  }
  if (url.hostname.length === 0) {
    throw new InvalidUrlError('URL has an empty hostname')
  }
  return url
}

/** Two URLs are same-origin when scheme, hostname, and port all match. */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/** Canonical `scheme://host[:port]` of a URL; the string the UI shows as origin. */
export function originOf(url: URL): string {
  return url.origin
}

/** The effective port of a URL: explicit, or the scheme default. */
export function effectivePort(url: URL): number {
  if (url.port !== '') return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

/** Bound an untrusted fragment embedded in an error message. */
export function truncateForMessage(text: string, maxLength = 200): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`
}
