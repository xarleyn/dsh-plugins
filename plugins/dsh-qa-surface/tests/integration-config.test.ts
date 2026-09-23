import { describe, expect, it } from "vitest";
import { DEFAULT_QA_SURFACE_CONFIG } from "../src/config-resolvers/defaults.js";
import { normalizeIntegrationBasePath } from "../src/config-resolvers/integration.js";
import { resolveConfig } from "../src/resolve-config.js";
import { schemaParse } from "./config.helpers.js";

/**
 * The integration API's configuration: off unless asked for, impossible to
 * point at the operator's own routes, and honest about needing accounts to
 * authenticate with.
 */

describe("integration config", () => {
  it("is off with the endpoints the bridge expects when nobody configures it", () => {
    const config = resolveConfig({});
    expect(config.integration).toEqual(DEFAULT_QA_SURFACE_CONFIG.integration);
    expect(config.integration.enabled).toBe(false);
    expect(config.integration.basePath).toBe("/qa/api");
    expect(config.integration.requestTimeoutMs).toBe(90_000);
    // The bridge publishes into a comment with its own budget.
    expect(config.integration.maxAnswerCharacters).toBe(4096);
  });

  it("normalizes the base path and refuses the namespaces it may not claim", () => {
    expect(normalizeIntegrationBasePath("/qa/api/")).toBe("/qa/api");
    expect(normalizeIntegrationBasePath("  /integration  ")).toBe(
      "/integration",
    );
    for (const bad of [
      "",
      "qa/api",
      "/",
      "/api",
      "/api/v1",
      "/plugins",
      "/plugins/x",
    ]) {
      expect(() => normalizeIntegrationBasePath(bad)).toThrow(TypeError);
    }
  });

  it("refuses to be switched on without accounts to authenticate against", () => {
    expect(() => resolveConfig({ integration: { enabled: true } })).toThrow(
      /requires accounts\.enabled/u,
    );
    expect(() =>
      resolveConfig({
        accounts: { enabled: true },
        integration: { enabled: true },
      }),
    ).not.toThrow();
  });

  it("allows long waits up to Node's faithful timer ceiling", () => {
    // The wait is not a budget the deployment spends: an integration asking a
    // long question must be able to allow it, and a ceiling here only ever cut
    // a legitimate answer off.
    const config = resolveConfig({
      accounts: { enabled: true },
      integration: { enabled: true, requestTimeoutMs: 1_800_000 },
    });
    expect(config.integration.requestTimeoutMs).toBe(1_800_000);
    expect(() =>
      resolveConfig({
        accounts: { enabled: true },
        integration: { enabled: true, requestTimeoutMs: 2_147_483_648 },
      }),
    ).toThrow(/requestTimeoutMs/u);
  });

  it("bounds every operator-tuned limit", () => {
    const config = resolveConfig({
      accounts: { enabled: true },
      integration: {
        enabled: true,
        tokenTtlDays: 30,
        requestTimeoutMs: 120_000,
        maxConcurrent: 2,
        requestsPerMinute: 10,
        maxRequestBytes: 2_097_152,
        maxAttachmentBytes: 1024,
        maxAnswerCharacters: 8192,
      },
    });
    expect(config.integration.tokenTtlDays).toBe(30);
    expect(config.integration.maxConcurrent).toBe(2);
    expect(config.integration.maxAnswerCharacters).toBe(8192);
    for (const input of [
      { tokenTtlDays: 0 },
      { requestTimeoutMs: 1 },
      { maxConcurrent: 0 },
      { requestsPerMinute: 0 },
      { maxRequestBytes: 10 },
      // A budget smaller than a sentence is not a publication.
      { maxAnswerCharacters: 8 },
      { maxAnswerCharacters: 100_000 },
    ]) {
      expect(() =>
        resolveConfig({
          accounts: { enabled: true },
          integration: { enabled: true, ...input },
        }),
      ).toThrow(TypeError);
    }
    // An attachment bigger than the request that carries it is a contradiction.
    expect(() =>
      resolveConfig({
        accounts: { enabled: true },
        integration: {
          enabled: true,
          maxRequestBytes: 1_048_576,
          maxAttachmentBytes: 2_097_152,
        },
      }),
    ).toThrow(TypeError);
  });

  it("resolves the same limits through the Host's schema path", () => {
    const config = resolveConfig(
      schemaParse({
        accounts: { enabled: true },
        integration: { enabled: true, basePath: "/bridge/api" },
      }),
    );
    expect(config.integration.basePath).toBe("/bridge/api");
    expect(config.integration.enabled).toBe(true);
    expect(config.integration.maxRequestBytes).toBe(33_554_432);
  });
});
