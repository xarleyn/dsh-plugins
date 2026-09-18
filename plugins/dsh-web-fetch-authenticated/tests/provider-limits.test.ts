/**
 * Integration suite over local fixture servers (SPEC §26.3): Bearer/Basic/API-key
 * auth, same-origin redirects, size/timeout limits, non-2xx-as-result, and the
 * sanitized tester/diagnose reports.
 */

import { afterAll, describe, expect, test } from "vitest";
import {
  configWith,
  fixtureRule,
  startFixture,
  type FixtureServer,
} from "./helpers.js";
import { expectCode, newProvider } from "./provider.helpers.js";

const servers: FixtureServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
});
async function track(server: FixtureServer): Promise<FixtureServer> {
  servers.push(server);
  return server;
}

describe("limits", () => {
  test("content-length over the cap rejects before reading", async () => {
    const server = await track(
      await startFixture({
        "/secure/big": {
          headers: { "content-length": String(1024 * 1024) },
          body: "x",
        },
      }),
    );
    const rule = fixtureRule(server.origin, {
      limits: { maxResponseBytes: 1024, timeoutMs: 5000 },
    });
    const { provider } = newProvider(configWith([rule]));
    await expectCode("AUTH_FETCH_RESPONSE_TOO_LARGE", () =>
      provider.fetch({ url: `${server.origin}/secure/big` }),
    );
  });

  test("streams growing past the cap are truncated, not failed", async () => {
    const server = await track(
      await startFixture({
        "/secure/stream": {
          body: "y".repeat(4096),
          headers: { "content-type": "text/plain" },
        },
      }),
    );
    const rule = fixtureRule(server.origin, {
      limits: { maxResponseBytes: 1024, maxBodyChars: 100000, timeoutMs: 5000 },
    });
    const { provider } = newProvider(configWith([rule]));
    const result = await provider.fetch({
      url: `${server.origin}/secure/stream`,
    });
    expect(result.truncated).toBe(true);
    expect(result.body.content).toHaveLength(1024);
  });

  test("timeout aborts with AUTH_FETCH_TIMEOUT", async () => {
    const server = await track(
      await startFixture({
        "/secure/slow": { delayMs: 2000, body: "late" },
      }),
    );
    const rule = fixtureRule(server.origin, { limits: { timeoutMs: 150 } });
    const { provider } = newProvider(configWith([rule]));
    await expectCode("AUTH_FETCH_TIMEOUT", () =>
      provider.fetch({ url: `${server.origin}/secure/slow` }),
    );
  });
});

describe("provider availability and error codes", () => {
  test("disabled config reports unavailable and fetch fails closed", async () => {
    const rule = fixtureRule("http://127.0.0.1:1");
    const config = configWith([rule], { enabled: false });
    const { provider } = newProvider(config);
    expect(provider.available()).toBe(false);
    await expectCode("AUTH_FETCH_RULE_DISABLED", () =>
      provider.fetch({ url: "http://127.0.0.1:1/open" }),
    );
  });

  test("available() stays true with rules present but a missing credential (fails per request)", () => {
    const rule = fixtureRule("http://127.0.0.1:1", {
      auth: { type: "bearer", credential: "ABSENT" },
    });
    const { provider } = newProvider(configWith([rule]));
    expect(provider.available()).toBe(true);
  });
});
