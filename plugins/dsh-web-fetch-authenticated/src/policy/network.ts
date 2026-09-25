/**
 * Pure IPv4/IPv6 classification and CIDR math for the SSRF policy (SPEC §10.1).
 * An address is judged by the bytes a connection reaches, so an IPv4 written
 * inside IPv6 gets the IPv4 verdict. No Node imports: the browser client bundle
 * reuses this module for configuration validation, so the file must stay
 * environment-free.
 * @module policy/network
 */

import type { NetworkClass } from "../types.js";

interface ParsedIp {
  readonly bytes: bigint;
  readonly bits: number;
  readonly family: 4 | 6;
}

/** Parse a dotted-quad IPv4 address, or `undefined` when malformed. */
export function parseIpv4(text: string): ParsedIp | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = (value << 8n) | BigInt(octet);
  }
  return { bytes: value, bits: 32, family: 4 };
}

/** Parse an IPv6 address (with `::` compression and IPv4 tails), or `undefined`. */
export function parseIpv6(text: string): ParsedIp | undefined {
  let head = text;
  const percent = head.indexOf("%");
  if (percent >= 0) head = head.slice(0, percent);
  let tail: readonly [number, number] | undefined;
  const lastColon = head.lastIndexOf(":");
  const afterColon = head.slice(lastColon + 1);
  if (afterColon.includes(".")) {
    const v4Tail = parseIpv4(afterColon);
    if (v4Tail === undefined) return undefined;
    tail = [
      Number((v4Tail.bytes >> 16n) & 0xffffn),
      Number(v4Tail.bytes & 0xffffn),
    ];
    // A dotted quad stands for the address's last two groups. Replacing it with
    // two placeholders keeps the group arithmetic — and any `::` compression
    // before it — reading one syntax instead of two.
    head = `${head.slice(0, lastColon + 1)}0:0`;
  }
  const double = head.split("::");
  if (double.length > 2) return undefined;
  const parseGroups = (side: string): number[] | undefined => {
    if (side === "") return [];
    const groups = side.split(":");
    const values: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/u.test(group)) return undefined;
      values.push(Number.parseInt(group, 16));
    }
    return values;
  };
  let groups: number[];
  if (double.length === 2) {
    const left = parseGroups(double[0] ?? "");
    const right = parseGroups(double[1] ?? "");
    if (left === undefined || right === undefined) return undefined;
    const fill = 8 - left.length - right.length;
    if (fill < 0) return undefined;
    groups = [...left, ...Array.from({ length: fill }, () => 0), ...right];
  } else {
    const only = parseGroups(head);
    if (only === undefined) return undefined;
    groups = only;
  }
  if (groups.length !== 8) return undefined;
  if (tail !== undefined) {
    const [high, low] = tail;
    groups[6] = high;
    groups[7] = low;
  }
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return { bytes: value, bits: 128, family: 6 };
}

/** Parse an IPv4 or IPv6 address literal. */
export function parseIp(text: string): ParsedIp | undefined {
  const candidate = text.trim().replace(/^\[|\]$/gu, "");
  return candidate.includes(":") ? parseIpv6(candidate) : parseIpv4(candidate);
}

interface ParsedCidr {
  readonly base: ParsedIp;
  readonly prefix: number;
}

/** Parse a `address/prefix` CIDR. A bare address is treated as a single-host CIDR. */
export function parseCidr(text: string): ParsedCidr | undefined {
  const candidate = text.trim();
  const slash = candidate.indexOf("/");
  const addressText = slash < 0 ? candidate : candidate.slice(0, slash);
  const prefixText = slash < 0 ? undefined : candidate.slice(slash + 1);
  const base = parseIp(addressText);
  if (base === undefined) return undefined;
  if (prefixText === undefined) return { base, prefix: base.bits };
  if (!/^\d{1,3}$/u.test(prefixText)) return undefined;
  const prefix = Number(prefixText);
  if (prefix > base.bits) return undefined;
  return { base, prefix };
}

/** Whether `cidr` contains `ip`. A mismatched family never contains. */
export function cidrContains(cidr: string, ip: string): boolean {
  const parsedCidr = parseCidr(cidr);
  const parsedIp = parseIp(ip);
  return (
    parsedCidr !== undefined &&
    parsedIp !== undefined &&
    containsCidr(parsedCidr, parsedIp)
  );
}

/** Whether one already-parsed address falls inside an already-parsed CIDR. */
function containsCidr(cidr: ParsedCidr, ip: ParsedIp): boolean {
  if (cidr.base.family !== ip.family) return false;
  const hostBits = BigInt(cidr.base.bits - cidr.prefix);
  const mask = ((1n << (BigInt(cidr.base.bits) - hostBits)) - 1n) << hostBits;
  return (cidr.base.bytes & mask) === (ip.bytes & mask);
}

/** Whether `text` parses as an IP literal. */
export function isIpLiteral(text: string): boolean {
  return parseIp(text) !== undefined;
}

/** Whether `text` parses as a CIDR (used by shared config validation). */
export function isCidr(text: string): boolean {
  return parseCidr(text) !== undefined;
}

/**
 * Cloud metadata/service endpoints blocked unconditionally (SPEC §10.3):
 * AWS/GCP/Azure IMDS, AWS ECS task metadata, and the AWS IMDS IPv6 endpoint.
 */
const METADATA_V4 = ["169.254.169.254", "169.254.170.2"] as const;
const METADATA_V6 = ["fd00:ec2::254"] as const;

/** The always-forbidden classes (SPEC §10.3: metadata has no v1 override). */
const ALWAYS_DENIED: ReadonlySet<NetworkClass> = new Set([
  "metadata",
  "multicast",
  "unspecified",
  "reserved",
  "broadcast",
]);

/**
 * The leading 96 bits of the IPv6 blocks that carry an IPv4 address in their
 * low 32 bits — the same host written in a second syntax (SPEC §10.1).
 */
const MAPPED_HIGH = 0x0000_0000_0000_ffffn; // ::ffff:x.y.z.w
const COMPATIBLE_HIGH = 0n; // ::x.y.z.w — the deprecated IPv4-compatible block
const NAT64_HIGH = 0x0064_ff9b_0000_0000_0000_0000n; // 64:ff9b::/96 well-known prefix

/** An IPv4 address embedded in an IPv6 literal. */
interface EmbeddedIpv4 {
  readonly address: bigint;
  /**
   * `mapped` IS the destination: Node and WHATWG URL both route
   * `::ffff:x.y.z.w` to that IPv4, so it must be classified as one.
   * `compatible` and `nat64` reach it only through a translation router this
   * plugin cannot verify, and neither is how an internal host is published, so
   * they fail closed rather than inherit the embedded address's class.
   */
  readonly route: "mapped" | "compatible" | "nat64";
}

function embeddedIpv4(ip: ParsedIp): EmbeddedIpv4 | undefined {
  if (ip.family !== 6) return undefined;
  const high = ip.bytes >> 32n;
  const low = ip.bytes & 0xffff_ffffn;
  if (high === MAPPED_HIGH) return { address: low, route: "mapped" };
  if (high === NAT64_HIGH) return { address: low, route: "nat64" };
  // `::` and `::1` are the unspecified and the IPv6 loopback addresses, not
  // IPv4-compatible spellings of 0.0.0.0 and 0.0.0.1.
  if (high === COMPATIBLE_HIGH && low > 1n) {
    return { address: low, route: "compatible" };
  }
  return undefined;
}

/** The byte address a connection to `ip` actually reaches. */
function destinationOf(ip: ParsedIp): ParsedIp {
  const embedded = embeddedIpv4(ip);
  if (embedded === undefined || embedded.route !== "mapped") return ip;
  return { bytes: embedded.address, bits: 32, family: 4 };
}

/**
 * The text to hand a socket for `ip`. An IPv4 destination is rewritten from
 * bytes, so a literal the parser read decimally (`010.0.0.1`) cannot be read
 * as anything else further down; an IPv6 destination keeps the text it came in.
 */
function addressText(ip: ParsedIp, written: string): string {
  if (ip.family !== 4) return written;
  const octet = (shift: bigint): string =>
    String(Number((ip.bytes >> shift) & 0xffn));
  return `${octet(24n)}.${octet(16n)}.${octet(8n)}.${octet(0n)}`;
}

/** Classify one IP literal, or `undefined` when it does not parse. */
export function classifyIp(text: string): NetworkClass | undefined {
  const ip = parseIp(text);
  return ip === undefined ? undefined : classify(destinationOf(ip));
}

/** Classify one already-parsed destination. */
function classify(ip: ParsedIp): NetworkClass {
  const embedded = embeddedIpv4(ip);
  if (embedded !== undefined && embedded.route !== "mapped") return "reserved";
  const inCidr = (cidr: string): boolean => {
    const parsed = parseCidr(cidr);
    return parsed !== undefined && containsCidr(parsed, ip);
  };
  if (ip.family === 4) {
    if (METADATA_V4.some(inCidr)) return "metadata";
    if (inCidr("0.0.0.0/8")) return "unspecified";
    if (inCidr("127.0.0.0/8")) return "loopback";
    if (
      inCidr("10.0.0.0/8") ||
      inCidr("172.16.0.0/12") ||
      inCidr("192.168.0.0/16")
    )
      return "private";
    if (inCidr("100.64.0.0/10")) return "cgnat";
    if (inCidr("169.254.0.0/16")) return "linkLocal";
    if (inCidr("224.0.0.0/4")) return "multicast";
    if (ip.bytes === 0xffff_ffffn) return "broadcast";
    if (
      inCidr("192.0.0.0/24") ||
      inCidr("192.0.2.0/24") ||
      inCidr("198.51.100.0/24") ||
      inCidr("203.0.113.0/24") ||
      inCidr("240.0.0.0/4") ||
      inCidr("255.255.255.254/32")
    )
      return "reserved";
    return "public";
  }
  if (METADATA_V6.some(inCidr)) return "metadata";
  if (inCidr("::/128")) return "unspecified";
  if (inCidr("::1/128")) return "loopback";
  if (inCidr("fc00::/7")) return "ipv6ULA";
  if (inCidr("fe80::/10")) return "ipv6LinkLocal";
  if (inCidr("ff00::/8")) return "multicast";
  if (inCidr("64:ff9b:1::/48") || inCidr("100::/64") || inCidr("2001:db8::/32"))
    return "reserved";
  return "public";
}

/** A resolved destination's classification plus the policy verdict for it. */
export interface AddressVerdict {
  readonly address: string;
  readonly family: 4 | 6;
  readonly networkClass: NetworkClass;
  readonly allowed: boolean;
  readonly reason: string;
}

/** Minimal policy face needed for the verdict, so callers can pass resolved or raw policies. */
export interface NetworkPolicyVerdictInput {
  readonly allowPublic: boolean;
  readonly allowPrivate: boolean;
  readonly allowLoopback: boolean;
  readonly allowLinkLocal: boolean;
  readonly allowCGNAT: boolean;
  readonly allowIPv6ULA: boolean;
  readonly allowedCidrs: readonly string[];
  readonly deniedCidrs: readonly string[];
}

const CLASS_FLAGS: Record<
  Exclude<
    NetworkClass,
    "metadata" | "multicast" | "unspecified" | "reserved" | "broadcast"
  >,
  keyof NetworkPolicyVerdictInput
> = {
  public: "allowPublic",
  loopback: "allowLoopback",
  private: "allowPrivate",
  cgnat: "allowCGNAT",
  ipv6ULA: "allowIPv6ULA",
  linkLocal: "allowLinkLocal",
  ipv6LinkLocal: "allowLinkLocal",
};

/** Decide one address against one rule's network policy (SPEC §10.1/§10.2). */
export function evaluateAddress(
  address: string,
  policy: NetworkPolicyVerdictInput,
): AddressVerdict {
  const parsed = parseIp(address);
  if (parsed === undefined) {
    return {
      address,
      family: address.includes(":") ? 6 : 4,
      networkClass: "unspecified",
      allowed: false,
      reason: "unparseable address",
    };
  }
  const destination = destinationOf(parsed);
  const verdict: Omit<AddressVerdict, "allowed" | "reason"> = {
    address: addressText(destination, address),
    family: destination.family,
    networkClass: classify(destination),
  };
  if (ALWAYS_DENIED.has(verdict.networkClass)) {
    return {
      ...verdict,
      allowed: false,
      reason: `${verdict.networkClass} destinations are always denied`,
    };
  }
  // An IPv4-mapped literal is one host in two byte forms. A deny rule has to
  // catch either spelling, while an allow rule opens only the destination it
  // actually names — the mapped form of an IPv6 allow entry stays IPv6.
  const forms: readonly ParsedIp[] =
    destination === parsed ? [parsed] : [destination, parsed];
  for (const cidr of policy.deniedCidrs) {
    const parsedCidr = parseCidr(cidr);
    if (
      parsedCidr !== undefined &&
      forms.some((form) => containsCidr(parsedCidr, form))
    ) {
      return {
        ...verdict,
        allowed: false,
        reason: `address is inside deniedCidrs ${cidr}`,
      };
    }
  }
  for (const cidr of policy.allowedCidrs) {
    const parsedCidr = parseCidr(cidr);
    if (parsedCidr !== undefined && containsCidr(parsedCidr, destination)) {
      return {
        ...verdict,
        allowed: true,
        reason: `address is inside allowedCidrs ${cidr}`,
      };
    }
  }
  const flag = CLASS_FLAGS[verdict.networkClass as keyof typeof CLASS_FLAGS];
  const allowed = flag !== undefined && policy[flag] === true;
  return {
    ...verdict,
    allowed,
    reason: allowed
      ? `${verdict.networkClass} access is permitted by the rule`
      : `${verdict.networkClass} access is not permitted by the rule`,
  };
}

/** Evaluate every resolved address; one denied answer denies the whole set. */
export function evaluateAddresses(
  addresses: readonly string[],
  policy: NetworkPolicyVerdictInput,
): {
  allowed: boolean;
  verdicts: readonly AddressVerdict[];
  firstDenied: AddressVerdict | undefined;
} {
  const verdicts = addresses.map((address) => evaluateAddress(address, policy));
  const firstDenied = verdicts.find((verdict) => !verdict.allowed);
  return { allowed: firstDenied === undefined, verdicts, firstDenied };
}
