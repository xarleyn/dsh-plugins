/**
 * DNS resolution under policy (SPEC §10.2): every request resolves the
 * hostname, EVERY answer must satisfy the rule's network policy (a mixed
 * public/private answer set is an attack, not an accident), and the connection
 * is pinned to the approved addresses so no re-resolution can bypass the check
 * between approval and connect.
 * @module policy/dns
 */

import { lookup } from 'node:dns'
import type { LookupAddress } from 'node:dns'
import type { LookupFunction } from 'node:net'
import { evaluateAddresses, parseIp } from './network.js'
import type { NetworkPolicyVerdictInput } from './network.js'
import type { AddressView } from '../types.js'

/** One approved destination the socket may connect to. */
export interface ApprovedAddress {
  readonly address: string
  readonly family: 4 | 6
}

/** Resolve a hostname to all its answers via the OS resolver. */
export function resolveHostname(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error !== null) {
        reject(error)
        return
      }
      resolve((addresses as readonly LookupAddress[]).map(entry => entry.address))
    })
  })
}

/** The resolver shape `resolveApprovedAddresses` depends on (injectable for tests). */
export type HostnameResolver = (hostname: string) => Promise<string[]>

/**
 * Resolve, classify, and policy-check a hostname. IP literals skip the
 * resolver and are classified directly. Throws `AddressPolicyDeniedError` when
 * any answer violates the policy and `AddressResolutionError` when resolution
 * itself fails — callers translate these into the seam's
 * `AUTH_FETCH_NETWORK_DENIED` / DNS codes.
 */
export async function resolveApprovedAddresses(
  hostname: string,
  policy: NetworkPolicyVerdictInput,
  resolver: HostnameResolver = resolveHostname,
): Promise<{ approved: readonly ApprovedAddress[]; verdicts: readonly AddressView[] }> {
  // WHATWG URL keeps brackets on IPv6 literals; classify the bare address.
  const bare = hostname.replace(/^\[/u, '').replace(/\]$/u, '')
  const literal = parseIp(bare)
  if (literal !== undefined) {
    const { allowed, verdicts, firstDenied } = evaluateAddresses([bare], policy)
    if (!allowed) {
      throw new AddressPolicyDeniedError(
        `address ${firstDenied?.address ?? ''} is not permitted: ${firstDenied?.reason ?? 'policy denied'}`,
        verdicts,
      )
    }
    return {
      approved: [{ address: bare, family: literal.family }],
      verdicts,
    }
  }
  let answers: string[]
  try {
    answers = await resolver(hostname)
  } catch (error: unknown) {
    throw new AddressResolutionError(`DNS resolution failed for "${hostname}": ${describeError(error)}`)
  }
  if (answers.length === 0) {
    throw new AddressResolutionError(`DNS resolution returned no addresses for "${hostname}"`)
  }
  const { allowed, verdicts, firstDenied } = evaluateAddresses(answers, policy)
  if (!allowed) {
    throw new AddressPolicyDeniedError(
      `resolved address ${firstDenied?.address ?? ''} is not permitted: ${firstDenied?.reason ?? 'policy denied'}`,
      verdicts,
    )
  }
  return {
    approved: verdicts.map(verdict => ({ address: verdict.address, family: verdict.family })),
    verdicts,
  }
}

/**
 * Build a `net.LookupFunction` pinned to the approved addresses. The socket
 * layer calls this instead of the resolver, so the addresses it connects to
 * are exactly the ones the policy approved (SPEC §10.2 step 4).
 */
export function pinnedLookup(approved: readonly ApprovedAddress[]): LookupFunction {
  return ((_hostname, options, callback) => {
    const family = (options as { family?: number | string }).family
    const wanted = typeof family === 'number' && family !== 0
      ? approved.filter(candidate => candidate.family === family)
      : approved
    const pool = wanted.length > 0 ? wanted : approved
    if ((options as { all?: boolean }).all === true) {
      callback(null, pool.map(candidate => ({ address: candidate.address, family: candidate.family })))
      return
    }
    const first = pool[0]
    if (first === undefined) {
      callback(new Error('no policy-approved address is available'), '', 4)
      return
    }
    callback(null, first.address, first.family)
  }) as LookupFunction
}

/** Human-safe description of a thrown value for embedding in sanitized errors. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** DNS lookup itself failed (unresolved host, resolver outage). */
export class AddressResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AddressResolutionError'
  }
}

/** The hostname resolved, but a policy check denied the answer set. */
export class AddressPolicyDeniedError extends Error {
  readonly verdicts: readonly AddressView[]
  constructor(message: string, verdicts: readonly AddressView[]) {
    super(message)
    this.name = 'AddressPolicyDeniedError'
    this.verdicts = verdicts
  }
}
