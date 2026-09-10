/**
 * Compatibility helpers for non-public DSH surfaces (SPEC §27). Everything
 * version-sensitive is quarantined here; INVESTIGATE.md §8 documents each
 * point. If a future DSH exposes a public accessor, only this file changes.
 * @module dsh-compat/web-status
 */

/**
 * Best-effort observation of the `ctx.web` fetch-provider selection.
 * `WebRuntime` keeps `fetchProviderId` private and publishes no accessor, so
 * this reads the field structurally and reports `undefined` on any mismatch —
 * diagnostic only; behavior never depends on it.
 */
export function observedFetchProviderId(web: unknown): string | undefined {
  if (web === undefined || web === null) return undefined
  const candidate = (web as { fetchProviderId?: unknown }).fetchProviderId
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
}
