import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { ResolvedQaBrowserConfig } from "../config.js";
import { QaBrowserError } from "../errors.js";

export type NetworkPolicyConfig =
  ResolvedQaBrowserConfig["security"]["network"];

export interface NetworkPolicyDependencies {
  readonly lookup?: typeof lookup;
  readonly dshOrigins?: readonly string[];
}

const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "100.100.100.200",
  "metadata.google.internal",
  "metadata.azure.internal",
]);

/** Remembered host resolutions before the map is dropped wholesale. */
const VERIFIED_RESOLUTIONS_LIMIT = 256;

function hostMatches(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === pattern;
}

function matchesAny(hostname: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => hostMatches(hostname, pattern));
}

function ipv4Parts(address: string): readonly number[] | null {
  const normalized = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(normalized) !== 4) return null;
  return normalized.split(".").map(Number);
}

function isLoopbackAddress(address: string): boolean {
  const ipv4 = ipv4Parts(address);
  if (ipv4 !== null) return ipv4[0] === 127;
  return address.toLowerCase() === "::1";
}

function isLinkLocalAddress(address: string): boolean {
  const ipv4 = ipv4Parts(address);
  if (ipv4 !== null) return ipv4[0] === 169 && ipv4[1] === 254;
  const normalized = address.toLowerCase();
  return /^fe[89ab][0-9a-f]:/u.test(normalized);
}

function isPrivateAddress(address: string): boolean {
  const ipv4 = ipv4Parts(address);
  if (ipv4 !== null) {
    return (
      ipv4[0] === 10 ||
      (ipv4[0] === 172 && (ipv4[1] ?? 0) >= 16 && (ipv4[1] ?? 0) <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168) ||
      (ipv4[0] === 100 && (ipv4[1] ?? 0) >= 64 && (ipv4[1] ?? 0) <= 127)
    );
  }
  const normalized = address.toLowerCase();
  return normalized.startsWith("fc") || normalized.startsWith("fd");
}

function isMetadataAddress(address: string): boolean {
  const ipv4 = ipv4Parts(address)?.join(".");
  return ipv4 === "169.254.169.254" || ipv4 === "100.100.100.200";
}

/**
 * Name the range a refused address belongs to, so an operator reading the
 * refusal knows whether a name resolves into the corporate network, a
 * carrier-grade NAT pool, or an IPv6 unique-local prefix. The address itself
 * stays out of the message: the class is what the fix depends on.
 */
function privateRangeOf(address: string): string {
  const ipv4 = ipv4Parts(address);
  if (ipv4 === null) return "IPv6 unique-local (fc00::/7)";
  return ipv4[0] === 100
    ? "carrier-grade NAT (100.64.0.0/10)"
    : "RFC1918 (10/8, 172.16/12, 192.168/16)";
}

/**
 * The refusal an operator can act on: it names the host, the class of address
 * it resolved to, and the setting that lifts the block. A hostname that
 * resolves privately is exactly the corporate case, so the message says what
 * to change instead of only that something was blocked.
 */
function privateNetworkRefusal(hostname: string, address: string): string {
  return (
    `Private-network destinations are blocked by Browser policy: "${hostname}" resolves to a ` +
    `${privateRangeOf(address)} address. Allow the host in security.network.allowHosts ` +
    `(or set security.network.allowPrivateNetworks) to reach it.`
  );
}

/** Server-side URL and DNS policy. Model arguments can never modify it. */
export class BrowserNetworkPolicy {
  private readonly resolveHost: typeof lookup;
  private readonly dshOrigins: ReadonlySet<string>;
  /** Address sets a successful `assertAllowed` verified, per hostname. */
  private readonly verifiedResolutions = new Map<string, readonly string[]>();

  constructor(
    readonly config: NetworkPolicyConfig,
    dependencies: NetworkPolicyDependencies = {},
  ) {
    this.resolveHost = dependencies.lookup ?? lookup;
    this.dshOrigins = new Set(
      (dependencies.dshOrigins ?? []).map((value) => new URL(value).origin),
    );
  }

  async assertAllowed(rawUrl: string): Promise<URL> {
    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch (error) {
      throw new QaBrowserError(
        "BROWSER_NAVIGATION_BLOCKED",
        "Navigation URL is not valid.",
        { cause: error },
      );
    }

    const scheme = target.protocol.slice(0, -1).toLowerCase();
    if (!this.config.allowedSchemes.includes(scheme)) {
      throw new QaBrowserError(
        "BROWSER_SCHEME_BLOCKED",
        `Navigation scheme ${target.protocol} is not allowed.`,
      );
    }
    if (target.username !== "" || target.password !== "") {
      throw new QaBrowserError(
        "BROWSER_NAVIGATION_BLOCKED",
        "Credentials in navigation URLs are not allowed.",
      );
    }

    const hostname = target.hostname.toLowerCase().replace(/\.$/u, "");
    if (hostname === "" || matchesAny(hostname, this.config.denyHosts)) {
      throw new QaBrowserError(
        "BROWSER_HOST_BLOCKED",
        "The destination host is blocked by Browser policy.",
      );
    }
    if (this.config.denyMetadataEndpoints && METADATA_HOSTS.has(hostname)) {
      throw new QaBrowserError(
        "BROWSER_HOST_BLOCKED",
        "Cloud metadata endpoints are blocked.",
      );
    }
    if (this.config.denyDshOrigin && this.dshOrigins.has(target.origin)) {
      throw new QaBrowserError(
        "BROWSER_DSH_ORIGIN_BLOCKED",
        "The active DSH origin is blocked from Browser automation.",
      );
    }

    const explicitlyAllowed = matchesAny(hostname, this.config.allowHosts);
    let addresses: readonly { address: string }[];
    if (isIP(hostname) !== 0) {
      addresses = [{ address: hostname }];
    } else {
      try {
        addresses = await this.resolveHost(hostname, {
          all: true,
          verbatim: true,
        });
      } catch (error) {
        throw new QaBrowserError(
          "BROWSER_HOST_BLOCKED",
          "The destination host could not be resolved safely.",
          { cause: error },
        );
      }
    }
    if (addresses.length === 0) {
      throw new QaBrowserError(
        "BROWSER_HOST_BLOCKED",
        "The destination host resolved to no addresses.",
      );
    }

    for (const { address } of addresses) {
      if (this.config.denyMetadataEndpoints && isMetadataAddress(address)) {
        throw new QaBrowserError(
          "BROWSER_HOST_BLOCKED",
          "Cloud metadata endpoints are blocked.",
        );
      }
      if (explicitlyAllowed) continue;
      if (isLoopbackAddress(address)) {
        if (this.config.allowLoopback) continue;
        throw new QaBrowserError(
          "BROWSER_HOST_BLOCKED",
          `Loopback destinations are blocked by Browser policy: "${hostname}" resolves to a ` +
            `loopback address. Allow the host in security.network.allowHosts (or set ` +
            `security.network.allowLoopback) to reach it.`,
        );
      }
      if (isLinkLocalAddress(address)) {
        throw new QaBrowserError(
          "BROWSER_HOST_BLOCKED",
          `Link-local destinations are blocked by Browser policy: "${hostname}" resolves to a ` +
            `link-local address (169.254/16, fe80::/10), which is never reachable by design.`,
        );
      }
      if (isPrivateAddress(address) && !this.config.allowPrivateNetworks) {
        throw new QaBrowserError(
          "BROWSER_HOST_BLOCKED",
          privateNetworkRefusal(hostname, address),
        );
      }
    }
    if (this.verifiedResolutions.size >= VERIFIED_RESOLUTIONS_LIMIT) {
      this.verifiedResolutions.clear();
    }
    this.verifiedResolutions.set(
      hostname,
      addresses.map(({ address }) => address),
    );
    return target;
  }

  /**
   * Double-resolve defense for the gap between this resolver and Chromium's
   * own: re-resolve the host a request is about to dial and compare against
   * the addresses `assertAllowed` just verified. An authoritative DNS that
   * answers differently between the two resolutions — the classic rebinding
   * move — is refused with the same taxonomy as `assertAllowed`.
   *
   * Residual TOCTOU: after this check passes and the request continues,
   * Chromium still resolves through its own recursive resolver, and a DNS
   * that pins a clean answer for this resolver and a private one for
   * Chromium's queries escapes both checks. The verification narrows the
   * rebinding window to a single hostile answer that must additionally be
   * consistent per resolver; it cannot close it without pinning the
   * connection to a verified address inside Chromium itself.
   */
  async assertUnchangedResolution(rawUrl: string): Promise<void> {
    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch (error) {
      throw new QaBrowserError(
        "BROWSER_NAVIGATION_BLOCKED",
        "Navigation URL is not valid.",
        { cause: error },
      );
    }
    const hostname = target.hostname.toLowerCase().replace(/\.$/u, "");
    const verified = this.verifiedResolutions.get(hostname);
    if (verified === undefined || isIP(hostname) !== 0) return;
    let addresses: readonly { address: string }[];
    try {
      addresses = await this.resolveHost(hostname, {
        all: true,
        verbatim: true,
      });
    } catch (error) {
      throw new QaBrowserError(
        "BROWSER_HOST_BLOCKED",
        "The destination host could not be resolved safely.",
        { cause: error },
      );
    }
    const current = addresses.map(({ address }) => address);
    if (
      current.length !== verified.length ||
      verified.some((address) => !current.includes(address))
    ) {
      throw new QaBrowserError(
        "BROWSER_HOST_BLOCKED",
        "The destination host resolved to different addresses than the ones the policy verified.",
      );
    }
  }
}
