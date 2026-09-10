/**
 * Centralized secret redaction (SPEC §11/§32.8): the ONLY scrubbing utilities
 * in the plugin. Logs, audit records, error details, and UI previews must run
 * untrusted/derived text through these instead of hand-rolling per-call
 * filters. Header construction never routes secrets here — it simply never
 * exposes them; redaction is the second line of defense.
 * @module audit/redact
 */

/** Header names whose values are secret in every context. */
export const SENSITIVE_HEADER_NAMES: readonly string[] = Object.freeze([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'private-token',
])

const REDACTED = '<redacted>'

/**
 * Redact a headers object for logging/diagnostics. Matching is case-insensitive;
 * sensitive values are replaced, never truncated into partial leakage.
 */
export function redactHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    output[name] = isSensitiveHeaderName(name) ? REDACTED : Array.isArray(value) ? value.join(', ') : value ?? ''
  }
  return output
}

/** Whether a header name carries a secret and must never be logged verbatim. */
export function isSensitiveHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.includes(name.toLowerCase())
}

/**
 * Scrub credential-shaped material out of free text (response previews, error
 * chains): `Authorization: Bearer …`, `api-key=…`, `token: …`, long base64url
 * JWT-ish runs, and URL query secrets.
 */
export function redactSecretsInText(text: string): string {
  let output = text
  // Scheme-qualified values first, so `Authorization: Bearer x` loses the
  // whole value and the generic key=value pass cannot strand a fragment.
  output = output.replace(/\bBearer\s+[A-Za-z0-9\-._~+/=]{6,}/giu, `Bearer ${REDACTED}`)
  output = output.replace(/\bBasic\s+[A-Za-z0-9+/=_.\-~]{6,}/giu, `Basic ${REDACTED}`)
  // JWT-shaped values even without a scheme prefix.
  output = output.replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]{2,})?/gu, REDACTED)
  output = output.replace(
    /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|pwd)\b(\s*[:=]\s*)(("[^"]*")|('[^']*')|([^\s,;&"']+))/giu,
    (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`,
  )
  return output
}

/**
 * Build a short preview of a response body that is safe to show in the UI:
 * length-capped first, then scrubbed, so a secret split across the cap cannot
 * reassemble either half.
 */
export function sanitizePreview(text: string, maxLength = 400): string {
  return redactSecretsInText(text.slice(0, maxLength))
}
