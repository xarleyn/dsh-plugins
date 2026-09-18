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
import { SECRET, expectCode, newProvider } from "./provider.helpers.js";

const servers: FixtureServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
});
async function track(server: FixtureServer): Promise<FixtureServer> {
  servers.push(server);
  return server;
}

describe("authentication injection", () => {
  test("bearer token reaches the fixture and the body comes back", async () => {
    const server = await track(
      await startFixture({
        "/secure/data": { body: "authed-body" },
      }),
    );
    const config = configWith([fixtureRule(server.origin)]);
    const { provider } = newProvider(config);
    const result = await provider.fetch({
      url: `${server.origin}/secure/data`,
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ kind: "text", content: "authed-body" });
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  test("basic auth builds the standard header from username + password credential", async () => {
    const server = await track(await startFixture({ "/secure/data": {} }));
    const rule = fixtureRule(server.origin, {
      auth: {
        type: "basic",
        username: "svc-account",
        passwordCredential: "TEST_PASSWORD",
      },
    });
    const { provider } = newProvider(configWith([rule]));
    const result = await provider.fetch({
      url: `${server.origin}/secure/data`,
    });
    expect(result.statusCode).toBe(200);
    const expected = Buffer.from(`svc-account:${SECRET}`, "utf8").toString(
      "base64",
    );
    expect(server.requests[0]?.headers.authorization).toBe(`Basic ${expected}`);
  });

  test("api key header uses the configured name and prefix", async () => {
    const server = await track(await startFixture({ "/secure/data": {} }));
    const rule = fixtureRule(server.origin, {
      auth: {
        type: "header",
        headerName: "X-API-Key",
        credential: "TEST_TOKEN",
        prefix: "ApiKey ",
      },
    });
    const { provider } = newProvider(configWith([rule]));
    await provider.fetch({ url: `${server.origin}/secure/data` });
    expect(server.requests[0]?.headers["x-api-key"]).toBe(`ApiKey ${SECRET}`);
    expect(server.requests[0]?.headers.authorization).toBeUndefined();
  });

  test("auth type none sends no credential headers", async () => {
    const server = await track(await startFixture({ "/open": {} }));
    const rule = fixtureRule(server.origin, { auth: { type: "none" } });
    const { provider } = newProvider(configWith([rule]));
    await provider.fetch({ url: `${server.origin}/open` });
    expect(server.requests[0]?.headers.authorization).toBeUndefined();
  });

  test("missing credential rejects with AUTH_FETCH_CREDENTIAL_MISSING per request", async () => {
    const server = await track(await startFixture({ "/secure/data": {} }));
    const rule = fixtureRule(server.origin, {
      auth: { type: "bearer", credential: "NOT_CONFIGURED" },
    });
    const { provider } = newProvider(configWith([rule]));
    await expectCode("AUTH_FETCH_CREDENTIAL_MISSING", () =>
      provider.fetch({ url: `${server.origin}/secure/data` }),
    );
    expect(server.requests).toHaveLength(0);
  });
});

describe("matching hygiene over HTTP", () => {
  test("denyPaths subtract from allowPaths", async () => {
    const server = await track(
      await startFixture({
        "/secure/ok": { body: "ok" },
        "/secure/private/config": { body: "nope" },
      }),
    );
    const rule = fixtureRule(server.origin, {
      match: {
        schemes: ["http"],
        hosts: ["127.0.0.1"],
        ports: [server.port],
        allowPaths: ["/secure/**"],
        denyPaths: ["/secure/private/**"],
      },
    });
    const { provider } = newProvider(configWith([rule]));
    const ok = await provider.fetch({ url: `${server.origin}/secure/ok` });
    expect(ok.statusCode).toBe(200);
    await expectCode("AUTH_FETCH_NO_MATCHING_RULE", () =>
      provider.fetch({ url: `${server.origin}/secure/private/config` }),
    );
  });

  test("ports outside the rule do not match", async () => {
    const rule = fixtureRule("http://127.0.0.1:1", {
      match: { schemes: ["http"], hosts: ["127.0.0.1"], ports: [1] },
    });
    const { provider } = newProvider(configWith([rule]));
    await expectCode("AUTH_FETCH_NO_MATCHING_RULE", () =>
      provider.fetch({ url: `http://127.0.0.1:${String(1 + 1)}/open` }),
    );
  });

  test("non-2xx responses are results, not errors", async () => {
    const server = await track(
      await startFixture({ "/secure/gone": { status: 404, body: "missing" } }),
    );
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]));
    const result = await provider.fetch({
      url: `${server.origin}/secure/gone`,
    });
    expect(result.statusCode).toBe(404);
    expect(result.body).toEqual({ kind: "text", content: "missing" });
  });

  test("unsupported binary content types reject", async () => {
    const server = await track(
      await startFixture({
        "/secure/blob": {
          headers: { "content-type": "application/octet-stream" },
          body: "bin",
        },
      }),
    );
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]));
    await expectCode("AUTH_FETCH_UNSUPPORTED_CONTENT", () =>
      provider.fetch({ url: `${server.origin}/secure/blob` }),
    );
  });
});
