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

/** Server-side URL and DNS policy. Model arguments can never modify it. */
export class BrowserNetworkPolicy {
  private readonly resolveHost: typeof lookup;
  private readonly dshOrigins: ReadonlySet<string>;

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
          "Loopback destinations are blocked by Browser policy.",
        );
      }
      if (isLinkLocalAddress(address)) {
        throw new QaBrowserError(
          "BROWSER_HOST_BLOCKED",
          "Link-local destinations are blocked by Browser policy.",
        );
      }
      if (isPrivateAddress(address) && !this.config.allowPrivateNetworks) {
        throw new QaBrowserError(
          "BROWSER_HOST_BLOCKED",
          "Private-network destinations are blocked by Browser policy.",
        );
      }
    }
    return target;
  }
}
