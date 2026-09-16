/**
 * Credential wiring (SPEC §12): the resolver as a unit, and the plugin's live
 * lookup under a real Cordis context.
 *
 * The regression this file exists for: the credential provider's fiber becomes
 * active only after this bundle is applied, and cordis' strict `ctx.get()`
 * reports a not-yet-active service as absent. A resolver built from a captured
 * `ctx.get('credentials')` therefore reports every configured reference as
 * unconfigured for the whole process lifetime.
 */

import { afterAll, describe, expect, test } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { createCredentialResolver } from "../src/credentials/resolver.js";
import type { CredentialsServiceLike } from "../src/credentials/resolver.js";
import { WebFetchAuthenticated } from "../src/index.js";
import {
  configWith,
  fixtureRule,
  startFixture,
  type FixtureServer,
} from "./helpers.js";

const SECRET = "fixture-secret-token";

/**
 * A provider shaped like the seam: `resolve` answers with the value and its
 * source, an empty stored value counts as absent, and `describe` never sees it.
 */
function providerFake(
  values: Record<string, string>,
): NonNullable<CredentialsServiceLike> {
  return {
    async resolve(ref: string) {
      const value = values[ref];
      return value === undefined || value.length === 0
        ? undefined
        : { value, source: "file" };
    },
    async describe(ref: string) {
      return { configured: (values[ref]?.length ?? 0) > 0, writable: true };
    },
  };
}

const servers: FixtureServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

describe("credential resolver", () => {
  test("reads the provider per operation, so one that mounts later is not lost", async () => {
    // Mounted only after the resolver is built: the provider a Host supplies
    // once its own fiber becomes active.
    const holder: { provider: CredentialsServiceLike } = {
      provider: undefined,
    };
    const resolver = createCredentialResolver(() => holder.provider);
    expect(await resolver.resolve("TEST_TOKEN")).toBeUndefined();
    expect(await resolver.describe("TEST_TOKEN")).toBeUndefined();
    holder.provider = providerFake({ TEST_TOKEN: SECRET });
    expect(await resolver.resolve("TEST_TOKEN")).toBe(SECRET);
    expect(await resolver.describe("TEST_TOKEN")).toEqual({
      configured: true,
      writable: true,
    });
  });

  test("a rotated value reaches the next operation", async () => {
    const values: Record<string, string> = { TEST_TOKEN: "first" };
    const resolver = createCredentialResolver(() => providerFake(values));
    expect(await resolver.resolve("TEST_TOKEN")).toBe("first");
    values["TEST_TOKEN"] = "second";
    expect(await resolver.resolve("TEST_TOKEN")).toBe("second");
  });

  test("an empty stored value reads as absent and a malformed name never resolves", async () => {
    const resolver = createCredentialResolver(() =>
      providerFake({ EMPTY_TOKEN: "", "BAD-NAME": SECRET }),
    );
    expect(await resolver.resolve("EMPTY_TOKEN")).toBeUndefined();
    expect(await resolver.describe("EMPTY_TOKEN")).toEqual({
      configured: false,
      writable: true,
    });
    expect(await resolver.resolve("BAD-NAME")).toBeUndefined();
    expect(await resolver.describe("BAD-NAME")).toBeUndefined();
  });

  test("a missing provider reads as unconfigured instead of throwing", async () => {
    const resolver = createCredentialResolver(() => undefined);
    expect(await resolver.resolve("TEST_TOKEN")).toBeUndefined();
    expect(await resolver.describe("TEST_TOKEN")).toBeUndefined();
  });
});

describe("plugin credential wiring", () => {
  test("credentials mounted after construction still authorize a test fetch", async () => {
    const server = await startFixture({
      "/secure/data": { body: '{"ok":true}' },
    });
    servers.push(server);
    const ctx = new Context();
    ctx.provide("web", { registerFetchProvider: () => () => {} });
    const config = configWith([
      fixtureRule(server.origin, { testUrl: `${server.origin}/secure/data` }),
    ]);
    // Constructed while no credential provider is mounted: the provider only
    // appears afterwards, exactly as it does during a Host boot.
    const plugin = new WebFetchAuthenticated(ctx, config);
    ctx.provide("credentials", providerFake({ TEST_TOKEN: SECRET }));

    const status = await plugin.status();
    expect(status.credentialStates).toEqual([
      { ref: "TEST_TOKEN", configured: true, writable: true, validName: true },
    ]);

    const report = await plugin.testRule("test-rule");
    expect(report.outcome).toBe("ok");
    expect(report.credentialState?.configured).toBe(true);
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);
  });
});
