/** Unit tests for the configuration surface (SPEC §23). */

import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CasError } from "../../src/cas/errors.js";
import { CAS_RESULTS_DEFAULTS, CasResultsConfigSchema, resolveCasResultsConfig } from "../../src/config.js";
import { resolveStoreDir } from "../../src/service.js";

describe("resolveCasResultsConfig", () => {
  it("applies the documented defaults (SPEC §23)", () => {
    const config = resolveCasResultsConfig({});
    expect(config.enabled).toBe(true);
    expect(config.storeDir).toBeNull();
    expect(config.thresholds).toEqual({ textBytes: 16_384, htmlBytes: 8_192, logBytes: 16_384 });
    expect(config.preview.maxChars).toBe(4_096);
    expect(config.preview.keepPatterns).toContain("error");
    expect(config.base64).toEqual({ enabled: true, minChars: 8_192, requireStrongDetection: true });
    expect(config.storage).toEqual({ compression: "auto", maxBytes: 10 * 1024 * 1024 * 1024 });
    expect(config.retrieval).toEqual({ defaultBytes: 32_768, maxBytes: 262_144 });
    expect(config.gc.enabled).toBe(true);
    expect(config.gc.ttlMs).toBe(30 * 24 * 3_600_000);
    expect(config.includeErrors).toBe(false);
    expect(config.exposeGcTool).toBe(false);
    // Editing tools stay excluded by default (SPEC §22).
    expect(config.excludeTools).toContain("write");
    expect(config.excludeTools).toContain("edit");
  });

  it("applies explicit overrides", () => {
    const config = resolveCasResultsConfig({
      enabled: false,
      storeDir: "  D:/tmp/cas  ",
      thresholds: { textBytes: 2_048 },
      preview: { maxChars: 1_024, keepPatterns: ["panic"] },
      tools: { bash: { thresholdBytes: 256, preview: "log" } },
      exposeGcTool: true,
    });
    expect(config.enabled).toBe(false);
    expect(config.storeDir).toBe("D:/tmp/cas");
    expect(config.thresholds.textBytes).toBe(2_048);
    expect(config.thresholds.htmlBytes).toBe(CAS_RESULTS_DEFAULTS.htmlBytes);
    expect(config.preview.keepPatterns).toEqual(["panic"]);
    expect(config.tools.bash?.thresholdBytes).toBe(256);
    expect(config.exposeGcTool).toBe(true);
  });

  it("rejects structurally impossible config loudly", () => {
    expect(() => resolveCasResultsConfig({ thresholds: { textBytes: -1 } })).toThrowError(CasError);
    expect(() => resolveCasResultsConfig({ storage: { compression: "brotli" as never } })).toThrowError(/compression/);
    expect(() => resolveCasResultsConfig({ retrieval: { defaultBytes: 4_096, maxBytes: 2_048 } })).toThrowError(/maxBytes/);
    expect(() => resolveCasResultsConfig({ gc: { intervalMs: 10 } })).toThrowError(/intervalMs/);
  });
});

describe("CasResultsConfigSchema", () => {
  it("fills every nested default for the empty object", () => {
    const applied = CasResultsConfigSchema({});
    const resolved = resolveCasResultsConfig(applied);
    expect(resolved.enabled).toBe(true);
    expect(resolved.base64.minChars).toBe(8_192);
  });
});

describe("resolveStoreDir", () => {
  it("prefers the explicit config path", () => {
    const config = resolveCasResultsConfig({ storeDir: "/var/lib/cas" });
    expect(resolveStoreDir(config, { DSH_HOME: "/home/dsh" })).toBe(resolve("/var/lib/cas"));
  });

  it("falls back to <DSH_HOME>/storages/dsh-cas-results (SPEC §14)", () => {
    const config = resolveCasResultsConfig({});
    expect(resolveStoreDir(config, { DSH_HOME: "/home/dsh" })).toBe(
      join(resolve("/home/dsh"), "storages", "dsh-cas-results"),
    );
  });

  it("uses ~/.dsh when DSH_HOME is blank", () => {
    const config = resolveCasResultsConfig({});
    const resolved = resolveStoreDir(config, { DSH_HOME: "   " });
    expect(resolved.endsWith(join("storages", "dsh-cas-results"))).toBe(true);
  });
});
