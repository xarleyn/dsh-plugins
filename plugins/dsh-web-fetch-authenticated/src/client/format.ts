/**
 * Pure client-side formatting and draft <-> config conversion helpers for the
 * settings card. No React, no host imports.
 * @module client/format
 */

import type { AuthConfig, AuthenticatedFetchRule, NetworkPolicy } from '../types.js'

/** Human summary of an auth configuration, e.g. `Bearer token` / `X-API-Key`. */
export function authSummary(auth: AuthConfig | undefined): string {
  if (auth === undefined) return 'None'
  if (auth.type === 'none') return 'None'
  if (auth.type === 'bearer') return 'Bearer token'
  if (auth.type === 'basic') return `Basic (${auth.username})`
  return `Header ${auth.headerName}`
}

/** Compact origin summary for a rule row. */
export function originSummary(rule: AuthenticatedFetchRule): string {
  const scheme = rule.match.schemes?.includes('http') === true ? 'https/http' : 'https'
  const hosts = rule.match.hosts.join(', ')
  const ports = rule.match.ports !== undefined && rule.match.ports.length > 0 ? `:${rule.match.ports.join('|')}` : ''
  return `${scheme}://${hosts}${ports}`
}

/** Join a list for textarea display (one entry per line). */
export function listToText(values: readonly string[] | undefined): string {
  return (values ?? []).join('\n')
}

/** Split textarea text into trimmed, non-empty lines. */
export function textToList(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
}

/** Parse a comma/space separated integer list, or `undefined` when blank. */
export function parsePortList(text: string): number[] | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.split(/[,\s]+/u).map(part => Number(part)).filter(part => Number.isInteger(part))
}

/** Parse integer limits from draft text; returns `undefined` for blank/invalid. */
export function parsePositiveInt(text: string): number | undefined {
  const value = Number(text.trim())
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/** Build the network policy half-draft checkbox state. */
export interface NetworkDraft {
  allowPublic: boolean
  allowPrivate: boolean
  allowLoopback: boolean
  allowLinkLocal: boolean
  allowCGNAT: boolean
  allowIPv6ULA: boolean
  allowedCidrs: string
  deniedCidrs: string
}

export function networkToDraft(policy: NetworkPolicy | undefined): NetworkDraft {
  return {
    allowPublic: policy?.allowPublic ?? true,
    allowPrivate: policy?.allowPrivate ?? false,
    allowLoopback: policy?.allowLoopback ?? false,
    allowLinkLocal: policy?.allowLinkLocal ?? false,
    allowCGNAT: policy?.allowCGNAT ?? false,
    allowIPv6ULA: policy?.allowIPv6ULA ?? false,
    allowedCidrs: listToText(policy?.allowedCidrs),
    deniedCidrs: listToText(policy?.deniedCidrs),
  }
}

export function networkFromDraft(draft: NetworkDraft): NetworkPolicy {
  const policy: NetworkPolicy = {
    allowPublic: draft.allowPublic,
    allowPrivate: draft.allowPrivate,
    allowLoopback: draft.allowLoopback,
    allowLinkLocal: draft.allowLinkLocal,
    allowCGNAT: draft.allowCGNAT,
    allowIPv6ULA: draft.allowIPv6ULA,
  }
  const allowed = textToList(draft.allowedCidrs)
  const denied = textToList(draft.deniedCidrs)
  if (allowed.length > 0) policy.allowedCidrs = allowed
  if (denied.length > 0) policy.deniedCidrs = denied
  return policy
}

/** Format a byte count for the tester report. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

/** A fresh stable rule id (SPEC §28). */
export function newRuleId(): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `rule-${uuid}`
}
