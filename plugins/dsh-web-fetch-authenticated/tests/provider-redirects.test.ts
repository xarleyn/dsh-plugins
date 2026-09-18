/**
 * Integration suite over local fixture servers (SPEC §26.3): Bearer/Basic/API-key
 * auth, same-origin redirects, size/timeout limits, non-2xx-as-result, and the
 * sanitized tester/diagnose reports.
 */

import { afterAll, describe, expect, test } from "vitest";
import { AuthenticatedFetchProvider } from "../src/provider.js";
import {
  configWith,
  fakeCredentials,
  fixtureRule,
  startFixture,
  type FixtureServer,
} from "./helpers.js";
import {
  SECRET,
  expectCode,
  newProvider,
  silentLogger,
} from "./provider.helpers.js";

const servers: FixtureServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
});
async function track(server: FixtureServer): Promise<FixtureServer> {
  servers.push(server);
  return server;
}

describe("redirect policy", () => {
  test("same-origin redirect keeps auth and follows", async () => {
    const server = await track(
      await startFixture({
        "/redirect/start": {
          redirectStatus: 302,
          redirectLocation: "/secure/final",
        },
        "/secure/final": { body: "final-body" },
      }),
    );
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]));
    const result = await provider.fetch({
      url: `${server.origin}/redirect/start`,
    });
    expect(result.body).toEqual({ kind: "text", content: "final-body" });
    expect(result.url).toBe(`${server.origin}/secure/final`);
    expect(server.requests[1]?.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  test("cross-origin redirect is denied with the auth never sent to the target", async () => {
    const other = await track(
      await startFixture({ "/steal": { body: "stolen" } }),
    );
    const server = await track(
      await startFixture({
        "/redirect/start": {
          redirectStatus: 302,
          redirectLocation: `${other.origin}/steal`,
        },
      }),
    );
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]));
    const error = await expectCode("AUTH_FETCH_REDIRECT_DENIED", () =>
      provider.fetch({ url: `${server.origin}/redirect/start` }),
    );
    expect(error).toContain(other.origin);
    expect(other.requests).toHaveLength(0);
  });

  test("redirect to a path outside allowPaths is denied (re-match of the same rule)", async () => {
    const server = await track(
      await startFixture({
        "/redirect/start": {
          redirectStatus: 302,
          redirectLocation: "/elsewhere",
        },
        "/elsewhere": { body: "leak" },
      }),
    );
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]));
    await expectCode("AUTH_FETCH_REDIRECT_DENIED", () =>
      provider.fetch({ url: `${server.origin}/redirect/start` }),
    );
    expect(server.requests).toHaveLength(1);
  });

  test("redirect budget is enforced", async () => {
    const server = await track(
      await startFixture(
        {
          "/redirect/1": {
            redirectStatus: 302,
            redirectLocation: "/redirect/2",
          },
          "/redirect/2": {
            redirectStatus: 302,
            redirectLocation: "/redirect/3",
          },
          "/redirect/3": {
            redirectStatus: 302,
            redirectLocation: "/redirect/4",
          },
          "/redirect/4": {
            redirectStatus: 302,
            redirectLocation: "/redirect/5",
          },
          "/redirect/5": { body: "far" },
        },
        { redirectStatus: 302, redirectLocation: "/redirect/loop" },
      ),
    );
    const rule = fixtureRule(server.origin, {
      match: {
        schemes: ["http"],
        hosts: ["127.0.0.1"],
        ports: [server.port],
        allowPaths: ["/redirect/**"],
      },
      redirects: { mode: "same-origin", maxRedirects: 2 },
    });
    const { provider } = newProvider(configWith([rule]));
    await expectCode("AUTH_FETCH_REDIRECT_DENIED", () =>
      provider.fetch({ url: `${server.origin}/redirect/1` }),
    );
  });

  test("allowlist redirect to a rule-authorized origin switches rules with their own credential", async () => {
    const target = await track(
      await startFixture({ "/secure/landing": { body: "landing" } }),
    );
    const server = await track(
      await startFixture({
        "/redirect/out": {
          redirectStatus: 302,
          redirectLocation: `${target.origin}/secure/landing`,
        },
      }),
    );
    const originRule = fixtureRule(server.origin, {
      id: "origin-rule",
      redirects: {
        mode: "allowlist",
        maxRedirects: 3,
        allowedOrigins: [target.origin],
      },
    });
    const targetRule = fixtureRule(target.origin, {
      id: "target-rule",
      auth: { type: "bearer", credential: "OTHER_TOKEN" },
    });
    const credentials = fakeCredentials({
      TEST_TOKEN: SECRET,
      OTHER_TOKEN: "target-secret",
    });
    const config = configWith([originRule, targetRule]);
    const provider = new AuthenticatedFetchProvider({
      configSource: () => config,
      credentials,
      logger: silentLogger(),
    });
    const result = await provider.fetch({
      url: `${server.origin}/redirect/out`,
    });
    expect(result.body).toEqual({ kind: "text", content: "landing" });
    // The target request must carry the TARGET rule's credential (invariant 4):
    // a credential never crosses into an origin its own rule does not authorize.
    expect(target.requests[0]?.headers.authorization).toBe(
      "Bearer target-secret",
    );
    expect(JSON.stringify(server.requests[0]?.headers)).toContain(SECRET);
  });

  test("mode none denies any redirect", async () => {
    const server = await track(
      await startFixture({
        "/redirect/start": { redirectStatus: 302, redirectLocation: "/open" },
      }),
    );
    const rule = fixtureRule(server.origin, {
      redirects: { mode: "none", maxRedirects: 3 },
    });
    const { provider } = newProvider(configWith([rule]));
    await expectCode("AUTH_FETCH_REDIRECT_DENIED", () =>
      provider.fetch({ url: `${server.origin}/redirect/start` }),
    );
  });
});
