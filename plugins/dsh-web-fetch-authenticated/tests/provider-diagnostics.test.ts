/**
 * Integration suite over local fixture servers (SPEC §26.3): Bearer/Basic/API-key
 * auth, same-origin redirects, size/timeout limits, non-2xx-as-result, and the
 * sanitized tester/diagnose reports.
 */

import { afterAll, describe, expect, test } from "vitest";
import { testRule, diagnose } from "../src/testing.js";
import {
  configWith,
  fakeCredentials,
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

describe("tester and diagnostics (UI API sanitization)", () => {
  test("testRule reports success without secrets and records the outcome", async () => {
    const server = await track(
      await startFixture({
        "/secure/data": { body: "hello body with Bearer abcdef123456 inside" },
      }),
    );
    const credentials = fakeCredentials({ TEST_TOKEN: SECRET });
    const config = configWith([
      fixtureRule(server.origin, { testUrl: `${server.origin}/secure/data` }),
    ]);
    const report = await testRule(
      { configSource: () => config, credentials },
      "test-rule",
    );
    expect(report.ok).toBe(true);
    expect(report.statusCode).toBe(200);
    expect(report.authApplied).toBe(true);
    expect(report.credentialState?.configured).toBe(true);
    // Preview is sanitized: the fake bearer-looking run is scrubbed.
    expect(report.preview).not.toContain("abcdef123456");
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  test("testRule reports network denial for private targets without a request", async () => {
    const server = await track(await startFixture({}));
    const rule = fixtureRule(server.origin, {
      networkPolicy: { allowLoopback: false },
    });
    const config = configWith([rule]);
    const report = await testRule(
      {
        configSource: () => config,
        credentials: fakeCredentials({ TEST_TOKEN: SECRET }),
      },
      "test-rule",
      `${server.origin}/secure/data`,
    );
    expect(report.ok).toBe(false);
    expect(report.outcome).toBe("AUTH_FETCH_NETWORK_DENIED");
    expect(server.requests).toHaveLength(0);
  });

  test("diagnose classifies DNS and match without sending anything", async () => {
    const server = await track(await startFixture({}));
    const config = configWith([fixtureRule(server.origin)]);
    const report = await diagnose(
      { configSource: () => config, credentials: fakeCredentials({}) },
      `${server.origin}/secure/anything`,
    );
    expect(report.match.ruleId).toBe("test-rule");
    expect(report.networkAllowed).toBe(true);
    expect(report.addresses[0]?.networkClass).toBe("loopback");
    expect(server.requests).toHaveLength(0);
  });

  test("diagnose reports unmatched URLs", async () => {
    const config = configWith([fixtureRule("http://127.0.0.1:1")]);
    const report = await diagnose(
      { configSource: () => config, credentials: fakeCredentials({}) },
      "https://jira.example.corp/browse/X",
    );
    expect(report.match.ruleId).toBeUndefined();
    expect(report.networkAllowed).toBe(false);
  });
});

describe("image downloads (the web_fetch_image transport)", () => {
  const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02,
  ]);

  test("serves the bytes of a raster image over the rule's transport", async () => {
    const server = await track(
      await startFixture({
        "/secure/screen.png": {
          bodyBytes: PNG_BYTES,
          headers: { "content-type": "image/png" },
        },
      }),
    );
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]));
    const image = await provider.fetchImage(
      { url: `${server.origin}/secure/screen.png` },
      { maxBytes: 1024 },
    );
    expect(image.statusCode).toBe(200);
    expect(image.mediaType).toBe("image/png");
    expect([...image.bytes]).toEqual([...PNG_BYTES]);
    expect(image.name).toBe("screen.png");
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  test("identifies the format from the bytes when the server mislabels it", async () => {
    // Jira serves attachments as a generic octet stream; the signature decides.
    const server = await track(
      await startFixture({
        "/secure/board.png": {
          bodyBytes: PNG_BYTES,
          headers: { "content-type": "application/octet-stream" },
        },
      }),
    );
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]));
    const image = await provider.fetchImage(
      { url: `${server.origin}/secure/board.png` },
      { maxBytes: 1024 },
    );
    expect(image.mediaType).toBe("image/png");
  });

  test("refuses a page that is not an image", async () => {
    const server = await track(
      await startFixture({
        "/secure/page": {
          body: "<html><body>login</body></html>",
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      }),
    );
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]));
    const message = await expectCode("AUTH_FETCH_NOT_AN_IMAGE", () =>
      provider.fetchImage(
        { url: `${server.origin}/secure/page` },
        { maxBytes: 1024 },
      ),
    );
    expect(message).toContain("text/html");
  });

  test("names the HTTP status of a failed download", async () => {
    const server = await track(
      await startFixture({
        "/secure/missing.png": {
          status: 404,
          body: "not found",
          headers: { "content-type": "text/plain" },
        },
      }),
    );
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]));
    const message = await expectCode("AUTH_FETCH_NOT_AN_IMAGE", () =>
      provider.fetchImage(
        { url: `${server.origin}/secure/missing.png` },
        { maxBytes: 1024 },
      ),
    );
    expect(message).toContain("HTTP 404");
  });

  test("refuses an image above the caller's byte budget", async () => {
    const server = await track(
      await startFixture({
        "/secure/huge.png": {
          bodyBytes: new Uint8Array(4096).fill(1),
          headers: { "content-type": "image/png" },
        },
      }),
    );
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]));
    const message = await expectCode("AUTH_FETCH_IMAGE_TOO_LARGE", () =>
      provider.fetchImage(
        { url: `${server.origin}/secure/huge.png` },
        { maxBytes: 512 },
      ),
    );
    expect(message).toContain("512");
  });

  test("keeps the rule matcher in front of the download", async () => {
    const server = await track(await startFixture({}));
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]));
    await expectCode("AUTH_FETCH_NO_MATCHING_RULE", () =>
      provider.fetchImage(
        { url: "https://example.test/other.png" },
        { maxBytes: 1024 },
      ),
    );
    expect(server.requests).toHaveLength(0);
  });
});
