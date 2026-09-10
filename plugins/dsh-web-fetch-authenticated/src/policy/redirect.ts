/**
 * Redirect policy (SPEC §10.5): every hop target is parsed, validated, and
 * re-matched against the rule set before it is followed. Authentication is
 * re-derived from the rule that matches the TARGET, so a credential can never
 * cross into an origin its rule does not authorize.
 * @module policy/redirect
 */

import type { ResolvedRedirectPolicy } from '../types.js'
import { isSameOrigin } from './url.js'

/** What may be done with a redirect to `target`. */
export type RedirectDecision =
  | { readonly action: 'follow'; readonly sameRule: boolean }
  | { readonly action: 'deny'; readonly reason: string }

/**
 * Decide a redirect from `current` to `target`.
 *
 * - `sameRule` is true when the target still matches the rule that authorized
 *   the original URL (the caller re-runs the match); in `same-origin` mode
 *   only such hops may be followed, and the same rule's auth is reused.
 * - In `allowlist` mode a hop to an explicitly allowed origin may switch to a
 *   DIFFERENT matching rule — the target's own credential applies after the
 *   target's own network policy passes, so no credential crosses an origin it
 *   does not belong to (invariant 4).
 * - In `none` mode every redirect is denied.
 *
 * @param policy - the ORIGINAL rule's redirect policy.
 * @param current - the URL the current hop was requested against.
 * @param target - the validated redirect target.
 * @param targetMatchesOriginalRule - whether the target still matches the original rule.
 * @param targetMatchesSomeRule - whether any enabled rule matches the target.
 */
export function decideRedirect(
  policy: ResolvedRedirectPolicy,
  current: URL,
  target: URL,
  targetMatchesOriginalRule: boolean,
  targetMatchesSomeRule: boolean,
): RedirectDecision {
  if (policy.mode === 'none') {
    return { action: 'deny', reason: 'redirects are disabled for this rule (mode none)' }
  }
  if (targetMatchesOriginalRule && isSameOrigin(target, current)) {
    return { action: 'follow', sameRule: true }
  }
  if (policy.mode === 'same-origin') {
    return {
      action: 'deny',
      reason: `cross-origin redirect to ${target.origin} is not followed (mode same-origin)`,
    }
  }
  // mode === 'allowlist'
  if (!targetMatchesSomeRule) {
    return { action: 'deny', reason: `redirect target ${target.origin} matches no enabled rule (mode allowlist)` }
  }
  const allowed = policy.allowedOrigins.some(origin => origin === target.origin)
  if (!allowed) {
    return { action: 'deny', reason: `redirect target ${target.origin} is not in the rule's allowedOrigins` }
  }
  return { action: 'follow', sameRule: targetMatchesOriginalRule }
}
