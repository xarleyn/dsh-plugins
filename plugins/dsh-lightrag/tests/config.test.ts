/** Unit tests for config resolution, endpoint validation and clamping (SPEC §4.2). */

import { describe, expect, it } from "vitest";

import {
  LIGHTRAG_DEFAULTS,
  LightRagConfigSchema,
  QUERY_MODES,
  resolveLightRagConfig,
  resolveLightRagEndpoint,
  resolveQueryMode,
} from "../src/config.js";

const NO_ENV = {};

describe("resolveLightRagConfig", () => {
  it("returns safe defaults for empty input", () => {
    expect(resolveLightRagConfig(undefined, NO_ENV)).toEqual(LIGHTRAG_DEFAULTS);
    expect(resolveLightRagConfig({}, NO_ENV)).toEqual(LIGHTRAG_DEFAULTS);
  });

  it("keeps writes off and the master switch on by default", () => {
    const config = resolveLightRagConfig({}, NO_ENV);
    expect(config.enabled).toBe(true);
    expect(config.writesEnabled).toBe(false);
  });

  it("honours in-range configuration", () => {
    const config = resolveLightRagConfig(
      {
        enabled: false,
        endpoint: "https://lightrag.internal:9621",
        apiKey: "  secret-key  ",
        timeoutMs: 5_000,
        query: { mode: "hybrid", topK: 50, maxAnswerBytes: 4_096 },
        documents: { maxListed: 25 },
        writes: { enabled: true, maxTextBytes: 8_192 },
      },
      NO_ENV,
    );
    expect(config).toEqual({
      enabled: false,
      endpoint: "https://lightrag.internal:9621",
      apiKey: "secret-key",
      timeoutMs: 5_000,
      queryMode: "hybrid",
      queryTopK: 50,
      queryMaxAnswerBytes: 4_096,
      documentsMaxListed: 25,
      writesEnabled: true,
      writesMaxTextBytes: 8_192,
    });
  });

  it("clamps every limit into its safe corridor", () => {
    const config = resolveLightRagConfig(
      {
        timeoutMs: 1,
        query: { topK: 0, maxAnswerBytes: 10 ** 9 },
        documents: { maxListed: 0 },
        writes: { maxTextBytes: -1 },
      },
      NO_ENV,
    );
    expect(config.timeoutMs).toBe(1_000);
    expect(config.queryTopK).toBe(1);
    expect(config.queryMaxAnswerBytes).toBe(1_048_576);
    expect(config.documentsMaxListed).toBe(1);
    expect(config.writesMaxTextBytes).toBe(1_024);

    const over = resolveLightRagConfig(
      {
        timeoutMs: 10 ** 9,
        query: { topK: 10 ** 6, maxAnswerBytes: 1 },
        documents: { maxListed: 10 ** 6 },
        writes: { maxTextBytes: 10 ** 9 },
      },
      NO_ENV,
    );
    expect(over.timeoutMs).toBe(300_000);
    expect(over.queryTopK).toBe(200);
    expect(over.queryMaxAnswerBytes).toBe(1_024);
    expect(over.documentsMaxListed).toBe(1_000);
    expect(over.writesMaxTextBytes).toBe(1_048_576);
  });

  it("floors fractional numbers and falls back on garbage", () => {
    const config = resolveLightRagConfig(
      {
        timeoutMs: 2_500.9,
        query: { topK: Number.NaN },
        documents: { maxListed: Number.POSITIVE_INFINITY },
      },
      NO_ENV,
    );
    expect(config.timeoutMs).toBe(2_500);
    expect(config.queryTopK).toBe(LIGHTRAG_DEFAULTS.queryTopK);
    expect(config.documentsMaxListed).toBe(
      LIGHTRAG_DEFAULTS.documentsMaxListed,
    );
  });

  it("falls back to LIGHTRAG_API_KEY when apiKey is unset or blank", () => {
    const fromEnvironment = resolveLightRagConfig(
      { endpoint: "http://lightrag:9621" },
      { LIGHTRAG_API_KEY: "  from-env  " },
    );
    expect(fromEnvironment.apiKey).toBe("from-env");

    const blankFallsBack = resolveLightRagConfig(
      { apiKey: "   " },
      { LIGHTRAG_API_KEY: "from-env" },
    );
    expect(blankFallsBack.apiKey).toBe("from-env");

    const explicitWins = resolveLightRagConfig(
      { apiKey: "from-config" },
      { LIGHTRAG_API_KEY: "from-env" },
    );
    expect(explicitWins.apiKey).toBe("from-config");

    expect(resolveLightRagConfig({}, NO_ENV).apiKey).toBe("");
  });
});

describe("resolveLightRagEndpoint", () => {
  it("accepts a bare origin and normalizes it", () => {
    expect(resolveLightRagEndpoint("http://lightrag:9621")).toBe(
      "http://lightrag:9621",
    );
    // A trailing slash is the form a browser copies; it is the same origin.
    expect(resolveLightRagEndpoint("http://lightrag:9621/")).toBe(
      "http://lightrag:9621",
    );
    expect(resolveLightRagEndpoint("  https://rag.example.com  ")).toBe(
      "https://rag.example.com",
    );
    // An explicit default port drops out of the normalized origin.
    expect(resolveLightRagEndpoint("https://rag.example.com:443")).toBe(
      "https://rag.example.com",
    );
  });

  it("falls back to the default for an empty value", () => {
    expect(resolveLightRagEndpoint("")).toBe(LIGHTRAG_DEFAULTS.endpoint);
    expect(resolveLightRagEndpoint("   ")).toBe(LIGHTRAG_DEFAULTS.endpoint);
    expect(resolveLightRagEndpoint(undefined)).toBe(LIGHTRAG_DEFAULTS.endpoint);
    expect(resolveLightRagEndpoint(42)).toBe(LIGHTRAG_DEFAULTS.endpoint);
  });

  it("rejects anything that is not a bare http(s) origin", () => {
    for (const endpoint of [
      "lightrag:9621",
      "ftp://lightrag:9621",
      "http://lightrag:9621/api",
      "http://lightrag:9621//v1",
      "http://lightrag:9621?key=1",
      "http://lightrag:9621#frag",
      "http://user:pass@lightrag:9621",
      "http://user@lightrag:9621",
      "not a url",
    ]) {
      expect(() => resolveLightRagEndpoint(endpoint), endpoint).toThrow(
        TypeError,
      );
    }
  });

  it("names the offending value in the error", () => {
    expect(() => resolveLightRagEndpoint("http://lightrag:9621/api")).toThrow(
      /http:\/\/lightrag:9621\/api/u,
    );
  });
});

describe("resolveQueryMode", () => {
  it("accepts the server's modes and falls back to mix", () => {
    for (const mode of QUERY_MODES) {
      expect(resolveQueryMode(mode)).toBe(mode);
    }
    expect(resolveQueryMode("semantic")).toBe(LIGHTRAG_DEFAULTS.queryMode);
    expect(resolveQueryMode("")).toBe(LIGHTRAG_DEFAULTS.queryMode);
    expect(resolveQueryMode(undefined)).toBe(LIGHTRAG_DEFAULTS.queryMode);
    expect(
      resolveLightRagConfig({ query: { mode: "nope" } }, NO_ENV).queryMode,
    ).toBe("mix");
  });
});

describe("LightRagConfigSchema", () => {
  it("exposes the same defaults through the Schemastery contract", () => {
    const resolved = LightRagConfigSchema({});
    expect(resolveLightRagConfig(resolved, NO_ENV)).toEqual(LIGHTRAG_DEFAULTS);
  });

  it("documents every field of the configuration surface", () => {
    const schema = LightRagConfigSchema as unknown as {
      dict?: Record<string, { meta?: { description?: string } }>;
    };
    for (const key of ["enabled", "endpoint", "apiKey", "timeoutMs"]) {
      expect(schema.dict?.[key]?.meta?.description, key).toBeTruthy();
    }
    for (const [group, keys] of Object.entries({
      query: ["mode", "topK", "maxAnswerBytes"],
      documents: ["maxListed"],
      writes: ["enabled", "maxTextBytes"],
    })) {
      const nested = schema.dict?.[group] as unknown as {
        dict?: Record<string, { meta?: { description?: string } }>;
      };
      for (const key of keys) {
        expect(
          nested?.dict?.[key]?.meta?.description,
          `${group}.${key}`,
        ).toBeTruthy();
      }
    }
  });
});
