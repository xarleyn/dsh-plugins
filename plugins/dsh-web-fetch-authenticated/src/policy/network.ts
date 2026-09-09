/**
 * Pure IPv4/IPv6 classification and CIDR math for the SSRF policy (SPEC §10.1).
 * No Node imports: the browser client bundle reuses this module for
 * configuration validation, so the file must stay environment-free.
 * @module policy/network
 */

import type { NetworkClass } from '../types.js'

interface ParsedIp {
  readonly bytes: bigint
  readonly bits: number
  readonly family: 4 | 6
}

/** Parse a dotted-quad IPv4 address, or `undefined` when malformed. */
export function parseIpv4(text: string): ParsedIp | undefined {
  const parts = text.split('.')
  if (parts.length !== 4) return undefined
  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return undefined
    const octet = Number(part)
    if (octet > 255) return undefined
    value = (value << 8n) | BigInt(octet)
  }
  return { bytes: value, bits: 32, family: 4 }
}

/** Parse an IPv6 address (with `::` compression and IPv4 tails), or `undefined`. */
export function parseIpv6(text: string): ParsedIp | undefined {
  let head = text
  let v4Tail: ParsedIp | undefined
  const percent = head.indexOf('%')
  if (percent >= 0) head = head.slice(0, percent)
  const lastColon = head.lastIndexOf(':')
  const tail = head.slice(lastColon + 1)
  if (tail.includes('.')) {
    v4Tail = parseIpv4(tail)
    if (v4Tail === undefined) return undefined
    head = `${head.slice(0, lastColon + 1)}0:0`
  }
  const double = head.split('::')
  if (double.length > 2) return undefined
  const parseGroups = (side: string): number[] | undefined => {
    if (side === '') return []
    const groups = side.split(':')
    const values: number[] = []
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/u.test(group)) return undefined
      values.push(Number.parseInt(group, 16))
    }
    return values
  }
  let groups: number[]
  if (double.length === 2) {
    const left = parseGroups(double[0] ?? '')
    const right = parseGroups(double[1] ?? '')
    if (left === undefined || right === undefined) return undefined
    const fill = 8 - left.length - right.length - (v4Tail === undefined ? 0 : 1)
    if (fill < 0) return undefined
    groups = [...left, ...Array.from({ length: fill }, () => 0), ...right]
  } else {
    const only = parseGroups(head)
    if (only === undefined) return undefined
    groups = only
  }
  if (v4Tail !== undefined) {
    if (groups.length !== 6) return undefined
    const tailBytes = v4Tail.bytes
    groups = [...groups, Number((tailBytes >> 48n) & 0xffffn), Number((tailBytes >> 32n) & 0xffffn)]
  }
  if (groups.length !== 8) return undefined
  let value = 0n
  for (const group of groups) value = (value << 16n) | BigInt(group)
  return { bytes: value, bits: 128, family: 6 }
}

/** Parse an IPv4 or IPv6 address literal. */
export function parseIp(text: string): ParsedIp | undefined {
  const candidate = text.trim().replace(/^\[|\]$/gu, '')
  return candidate.includes(':') ? parseIpv6(candidate) : parseIpv4(candidate)
}

interface ParsedCidr {
  readonly base: ParsedIp
  readonly prefix: number
}

/** Parse a `address/prefix` CIDR. A bare address is treated as a single-host CIDR. */
export function parseCidr(text: string): ParsedCidr | undefined {
  const candidate = text.trim()
  const slash = candidate.indexOf('/')
  const addressText = slash < 0 ? candidate : candidate.slice(0, slash)
  const prefixText = slash < 0 ? undefined : candidate.slice(slash + 1)
  const base = parseIp(addressText)
  if (base === undefined) return undefined
  if (prefixText === undefined) return { base, prefix: base.bits }
  if (!/^\d{1,3}$/u.test(prefixText)) return undefined
  const prefix = Number(prefixText)
  if (prefix > base.bits) return undefined
  return { base, prefix }
}

/** Whether `cidr` contains `ip`. A mismatched family never contains. */
export function cidrContains(cidr: string, ip: string): boolean {
  const parsedCidr = parseCidr(cidr)
  const parsedIp = parseIp(ip)
  if (parsedCidr === undefined || parsedIp === undefined) return false
  if (parsedCidr.base.family !== parsedIp.family) return false
  const hostBits = BigInt(parsedCidr.base.bits - parsedCidr.prefix)
  const mask = ((1n << (BigInt(parsedCidr.base.bits) - hostBits)) - 1n) << hostBits
  return (parsedCidr.base.bytes & mask) === (parsedIp.bytes & mask)
}

/** Whether `text` parses as an IP literal. */
export function isIpLiteral(text: string): boolean {
  return parseIp(text) !== undefined
}

/** Whether `text` parses as a CIDR (used by shared config validation). */
export function isCidr(text: string): boolean {
  return parseCidr(text) !== undefined
}

/**
 * Cloud metadata/service endpoints blocked unconditionally (SPEC §10.3):
 * AWS/GCP/Azure IMDS, AWS ECS task metadata, and the AWS IMDS IPv6 endpoint.
 */
const METADATA_V4 = ['169.254.169.254', '169.254.170.2'] as const
const METADATA_V6 = ['fd00:ec2::254'] as const

/** The always-forbidden classes (SPEC §10.3: metadata has no v1 override). */
const ALWAYS_DENIED: ReadonlySet<NetworkClass> = new Set([
  'metadata',
  'multicast',
  'unspecified',
  'reserved',
  'broadcast',
])

/** Classify one IP literal, or `undefined` when it does not parse. */
export function classifyIp(text: string): NetworkClass | undefined {
  const ip = parseIp(text)
  if (ip === undefined) return undefined
  const inCidr = (cidr: string): boolean => cidrContains(cidr, text)
  if (ip.family === 4) {
    if (METADATA_V4.some(inCidr)) return 'metadata'
    if (inCidr('0.0.0.0/8')) return 'unspecified'
    if (inCidr('127.0.0.0/8')) return 'loopback'
    if (inCidr('10.0.0.0/8') || inCidr('172.16.0.0/12') || inCidr('192.168.0.0/16')) return 'private'
    if (inCidr('100.64.0.0/10')) return 'cgnat'
    if (inCidr('169.254.0.0/16')) return 'linkLocal'
    if (inCidr('224.0.0.0/4')) return 'multicast'
    if (text === '255.255.255.255') return 'broadcast'
    if (
      inCidr('192.0.0.0/24') || inCidr('192.0.2.0/24') || inCidr('198.51.100.0/24')
      || inCidr('203.0.113.0/24') || inCidr('240.0.0.0/4') || inCidr('255.255.255.254/32')
    ) return 'reserved'
    return 'public'
  }
  if (METADATA_V6.some(inCidr)) return 'metadata'
  if (inCidr('::/128')) return 'unspecified'
  if (inCidr('::1/128')) return 'loopback'
  if (inCidr('fc00::/7')) return 'ipv6ULA'
  if (inCidr('fe80::/10')) return 'ipv6LinkLocal'
  if (inCidr('ff00::/8')) return 'multicast'
  if (inCidr('64:ff9b:1::/48') || inCidr('100::/64') || inCidr('2001:db8::/32')) return 'reserved'
  return 'public'
}

/** A resolved destination's classification plus the policy verdict for it. */
export interface AddressVerdict {
  readonly address: string
  readonly family: 4 | 6
  readonly networkClass: NetworkClass
  readonly allowed: boolean
  readonly reason: string
}

/** Minimal policy face needed for the verdict, so callers can pass resolved or raw policies. */
export interface NetworkPolicyVerdictInput {
  readonly allowPublic: boolean
  readonly allowPrivate: boolean
  readonly allowLoopback: boolean
  readonly allowLinkLocal: boolean
  readonly allowCGNAT: boolean
  readonly allowIPv6ULA: boolean
  readonly allowedCidrs: readonly string[]
  readonly deniedCidrs: readonly string[]
}

const CLASS_FLAGS: Record<Exclude<NetworkClass, 'metadata' | 'multicast' | 'unspecified' | 'reserved' | 'broadcast'>, keyof NetworkPolicyVerdictInput> = {
  public: 'allowPublic',
  loopback: 'allowLoopback',
  private: 'allowPrivate',
  cgnat: 'allowCGNAT',
  ipv6ULA: 'allowIPv6ULA',
  linkLocal: 'allowLinkLocal',
  ipv6LinkLocal: 'allowLinkLocal',
}

/** Decide one address against one rule's network policy (SPEC §10.1/§10.2). */
export function evaluateAddress(address: string, policy: NetworkPolicyVerdictInput): AddressVerdict {
  const parsed = parseIp(address)
  const family: 4 | 6 = parsed?.family ?? (address.includes(':') ? 6 : 4)
  const networkClass = classifyIp(address)
  if (networkClass === undefined) {
    return { address, family, networkClass: 'unspecified', allowed: false, reason: 'unparseable address' }
  }
  if (ALWAYS_DENIED.has(networkClass)) {
    return { address, family, networkClass, allowed: false, reason: `${networkClass} destinations are always denied` }
  }
  for (const cidr of policy.deniedCidrs) {
    if (cidrContains(cidr, address)) {
      return { address, family, networkClass, allowed: false, reason: `address is inside deniedCidrs ${cidr}` }
    }
  }
  for (const cidr of policy.allowedCidrs) {
    if (cidrContains(cidr, address)) {
      return { address, family, networkClass, allowed: true, reason: `address is inside allowedCidrs ${cidr}` }
    }
  }
  const flag = CLASS_FLAGS[networkClass as keyof typeof CLASS_FLAGS]
  const allowed = flag !== undefined && policy[flag] === true
  return {
    address,
    family,
    networkClass,
    allowed,
    reason: allowed
      ? `${networkClass} access is permitted by the rule`
      : `${networkClass} access is not permitted by the rule`,
  }
}

/** Evaluate every resolved address; one denied answer denies the whole set. */
export function evaluateAddresses(addresses: readonly string[], policy: NetworkPolicyVerdictInput): {
  allowed: boolean
  verdicts: readonly AddressVerdict[]
  firstDenied: AddressVerdict | undefined
} {
  const verdicts = addresses.map(address => evaluateAddress(address, policy))
  const firstDenied = verdicts.find(verdict => !verdict.allowed)
  return { allowed: firstDenied === undefined, verdicts, firstDenied }
}
