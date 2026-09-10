/**
 * Authentication header construction (SPEC §8). Builders receive already
 * resolved secret VALUES and return header maps; values never outlive the
 * returned object and are never logged. The caller attaches authentication
 * only after URL validation, rule matching, and network-policy approval
 * (invariant 3).
 * @module auth
 */

import type { AuthConfig, ResolvedRule } from '../types.js'
import { FORBIDDEN_HEADER_NAMES } from '../rule-validation.js'

/** Secret values resolved for one request, addressed by the rule's own references. */
export interface ResolvedAuthSecrets {
  /** The bearer/header credential value. */
  readonly credential?: string
  /** The basic-auth password value. */
  readonly password?: string
}

/** Which credential references a rule's auth needs (for resolver + UI state). */
export function requiredCredentialRefs(auth: AuthConfig): string[] {
  if (auth.type === 'bearer' || auth.type === 'header') return [auth.credential]
  if (auth.type === 'basic') return [auth.passwordCredential]
  return []
}

/** The single reference a rule's auth resolves, for diagnostics. */
export function primaryCredentialRef(auth: AuthConfig): string | undefined {
  return requiredCredentialRefs(auth)[0]
}

/**
 * Build the authentication headers for one request.
 * @param rule - the resolved rule that matched the URL.
 * @param secrets - the resolved credential values for the rule's references.
 * @returns the headers to merge into the request, or `undefined` when the
 *   auth type is `none`.
 * @throws TypeError when a required secret is absent (callers resolve first;
 *   this guard keeps a missing resolution from silently sending no auth).
 */
export function buildAuthHeaders(rule: ResolvedRule, secrets: ResolvedAuthSecrets): Record<string, string> | undefined {
  const auth = rule.source.auth
  if (auth.type === 'none') return undefined
  if (auth.type === 'bearer') {
    const credential = secrets.credential
    if (credential === undefined || credential.length === 0) {
      throw new TypeError('bearer credential value is missing')
    }
    return { authorization: `Bearer ${credential}` }
  }
  if (auth.type === 'basic') {
    const password = secrets.password
    if (password === undefined || password.length === 0) {
      throw new TypeError('basic password value is missing')
    }
    const encoded = Buffer.from(`${auth.username}:${password}`, 'utf8').toString('base64')
    return { authorization: `Basic ${encoded}` }
  }
  const credential = secrets.credential
  if (credential === undefined || credential.length === 0) {
    throw new TypeError('header credential value is missing')
  }
  const headerName = auth.headerName.toLowerCase()
  if (FORBIDDEN_HEADER_NAMES.includes(headerName)) {
    throw new TypeError(`header name "${auth.headerName}" is a forbidden transport header`)
  }
  return { [headerName]: `${auth.prefix ?? ''}${credential}` }
}
