import type { lookup } from "node:dns/promises";

import { describe, expect, it } from "vitest";

import { resolveQaBrowserConfig, type QaBrowserConfig } from "../src/config.js";
import { QaBrowserError } from "../src/errors.js";
import { BrowserNetworkPolicy } from "../src/host/policy.js";

function resolver(addresses: Record<string, string[]>): typeof lookup {
  return (async (hostname: string) =>
    (addresses[hostname] ?? []).map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }))) as unknown as typeof lookup;
}

type NetworkInput = NonNullable<
  NonNullable<QaBrowserConfig["security"]>["network"]
>;

function policy(network: NetworkInput = {}) {
  const config = resolveQaBrowserConfig({ security: { network } });
  return new BrowserNetworkPolicy(config.security.network, {
    lookup: resolver({
      "public.example": ["203.0.113.10"],
      "private.example": ["10.0.0.5"],
      "mixed.example": ["203.0.113.10", "192.168.1.5"],
      "metadata.example": ["169.254.169.254"],
      "dsh.example": ["203.0.113.20"],
    }),
    dshOrigins: ["https://dsh.example:443"],
  });
}

async function errorCode(
  promise: Promise<unknown>,
): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof QaBrowserError ? error.code : undefined;
  }
}

describe("BrowserNetworkPolicy", () => {
  it("allows public http(s) and rejects non-network schemes and URL credentials", async () => {
    await expect(
      policy().assertAllowed("https://public.example/path"),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      errorCode(policy().assertAllowed("file:///etc/passwd")),
    ).resolves.toBe("BROWSER_SCHEME_BLOCKED");
    await expect(
      errorCode(policy().assertAllowed("https://user:secret@public.example")),
    ).resolves.toBe("BROWSER_NAVIGATION_BLOCKED");
  });

  it("fails closed when any resolved address crosses the private boundary", async () => {
    await expect(
      errorCode(policy().assertAllowed("https://private.example")),
    ).resolves.toBe("BROWSER_HOST_BLOCKED");
    await expect(
      errorCode(policy().assertAllowed("https://mixed.example")),
    ).resolves.toBe("BROWSER_HOST_BLOCKED");
  });

  it("uses explicit hosts as private-network exceptions but never metadata exceptions", async () => {
    await expect(
      policy({ allowHosts: ["private.example"] }).assertAllowed(
        "https://private.example",
      ),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      errorCode(
        policy({ allowHosts: ["metadata.example"] }).assertAllowed(
          "http://metadata.example/latest/meta-data",
        ),
      ),
    ).resolves.toBe("BROWSER_HOST_BLOCKED");
  });

  it("gives deny rules and the DSH self-origin priority", async () => {
    await expect(
      errorCode(
        policy({
          allowHosts: ["*.example"],
          denyHosts: ["private.example"],
        }).assertAllowed("https://private.example"),
      ),
    ).resolves.toBe("BROWSER_HOST_BLOCKED");
    await expect(
      errorCode(policy().assertAllowed("https://dsh.example/settings")),
    ).resolves.toBe("BROWSER_DSH_ORIGIN_BLOCKED");
  });
});
