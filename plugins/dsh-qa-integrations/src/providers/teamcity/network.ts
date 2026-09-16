/**
 * Address policy of the TeamCity provider.
 *
 * A TeamCity server is usually self-hosted, so the useful question is never
 * "is this address public?" but "did the operator say this deployment may dial
 * it?". The user names the server, the operator names the addresses that may be
 * named, and a URL that does not fit that list never reaches the network. The
 * same check runs when the credential is stored and again on every call, so
 * tightening the policy closes existing connections instead of only new ones.
 */
export type TeamCityNetworkMode = "allowlist" | "trusted-private";

export interface TeamCityNetworkPolicy {
  readonly mode: TeamCityNetworkMode;
  /** Exact hostnames or `*.suffix` patterns, matched case-insensitively. */
  readonly allowedHosts: readonly string[];
  /** IPv4 networks a literal address must fall into; never matches a hostname. */
  readonly allowedCidrs: readonly string[];
  /** Ports a server URL may use; empty means the scheme default alone. */
  readonly allowedPorts: readonly number[];
  readonly allowHttp: boolean;
}

/** Private ranges `trusted-private` accepts when the operator names none. */
export const PRIVATE_CIDRS: readonly string[] = Object.freeze([
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
]);

const MAX_URL_LENGTH = 2_048;

function ipv4ToInt(value: string): number | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    result = result * 256 + octet;
  }
  return result >>> 0;
}

/** True for `a.b.c.d` and for the bracketed IPv6 form a WHATWG URL reports. */
export function isIpLiteral(hostname: string): boolean {
  return ipv4ToInt(hostname) !== undefined || hostname.startsWith("[");
}

function isPrivateAddress(hostname: string, cidrs: readonly string[]): boolean {
  const address = ipv4ToInt(hostname);
  if (address === undefined) return false;
  return cidrs.some((cidr) => {
    const [network, prefixText = "32"] = cidr.split("/");
    const base = network === undefined ? undefined : ipv4ToInt(network);
    const prefix = Number(prefixText);
    if (base === undefined || !Number.isInteger(prefix)) return false;
    if (prefix <= 0) return true;
    if (prefix > 32) return false;
    // Shifting by 32 is undefined in JavaScript, so a full /32 is exact match.
    const mask =
      prefix === 32 ? 0xffff_ffff : (0xffff_ffff << (32 - prefix)) >>> 0;
    return (address & mask) >>> 0 === (base & mask) >>> 0;
  });
}

/** `example.com` matches itself, `*.corp.example` matches its subdomains. */
function matchesHostPattern(hostname: string, pattern: string): boolean {
  if (!pattern.startsWith("*.")) return hostname === pattern;
  const suffix = pattern.slice(1);
  return hostname.endsWith(suffix) && hostname.length > suffix.length;
}

function hostAllowed(hostname: string, policy: TeamCityNetworkPolicy): boolean {
  if (isIpLiteral(hostname)) {
    // A literal address is only ever matched by a network, never by a name:
    // a pattern like `*.corp.example` says nothing about `10.0.0.7`.
    const cidrs =
      policy.allowedCidrs.length > 0
        ? policy.allowedCidrs
        : policy.mode === "trusted-private"
          ? PRIVATE_CIDRS
          : [];
    return isPrivateAddress(hostname, cidrs);
  }
  if (policy.mode === "trusted-private") {
    // The operator declared this deployment trusted, which is what makes any
    // name dialable — including an internal one that resolves to a private
    // address. Public suffixes are not filtered here; see the README, which
    // states that `trusted-private` assumes the deployment trusts its own DNS.
    return true;
  }
  return policy.allowedHosts.some((pattern) =>
    matchesHostPattern(hostname, pattern),
  );
}

/** Operator typo in an address policy, so config load fails with a reason. */
export function hostPatternProblem(value: string): string | undefined {
  const pattern = value.trim().toLowerCase();
  if (pattern === "" || pattern.length > 253) return "host pattern is invalid";
  // A `*.suffix` wildcard is the only pattern form; everything else has to be a
  // plain hostname, because a half-supported glob would silently never match.
  const host = pattern.startsWith("*.") ? pattern.slice(2) : pattern;
  if (host.startsWith("*")) return "host pattern is invalid";
  if (isIpLiteral(host)) return "an address belongs in allowedCidrs";
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(host)) {
    return "host pattern is invalid";
  }
  return undefined;
}

/** Operator typo in a network; IPv4 only, which is what TeamCity on-prem uses. */
export function cidrProblem(value: string): string | undefined {
  const [network, prefixText = "32"] = value.trim().split("/");
  if (network === undefined || ipv4ToInt(network) === undefined) {
    return "CIDR must be an IPv4 network such as 10.0.0.0/8";
  }
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return "CIDR prefix must be between 0 and 32";
  }
  return undefined;
}

/**
 * Why this server URL may not be dialled, or `undefined` when it may. The
 * caller picks the error code: a connect form refusal is a credential problem,
 * a runtime refusal is a deployment policy that moved under a stored token.
 */
export function serverUrlProblem(
  raw: string,
  policy: TeamCityNetworkPolicy,
): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > MAX_URL_LENGTH) {
    return "TeamCity URL is invalid";
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "TeamCity URL is invalid";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "TeamCity URL must use HTTP or HTTPS";
  }
  if (url.protocol === "http:" && !policy.allowHttp) {
    return "TeamCity URL must use HTTPS";
  }
  if (url.username !== "" || url.password !== "") {
    return "TeamCity URL must carry no credentials";
  }
  if (url.search !== "" || url.hash !== "") {
    return "TeamCity URL must carry no query or fragment";
  }
  const port =
    url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  const allowed =
    policy.allowedPorts.length > 0
      ? policy.allowedPorts
      : [url.protocol === "https:" ? 443 : 80];
  if (!allowed.includes(port)) {
    return `TeamCity URL must use one of the configured ports: ${allowed.join(", ")}`;
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (hostname === "") return "TeamCity URL is invalid";
  if (!hostAllowed(hostname, policy)) {
    return "TeamCity URL is not allowed by this deployment";
  }
  return undefined;
}

/**
 * Canonical `<origin><path>`, without a trailing slash. TeamCity is often
 * mounted under a subpath, so the path stays; `..` segments were already folded
 * away by the URL parser.
 */
export function canonicalServerUrl(raw: string): string {
  const url = new URL(raw.trim());
  return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}
