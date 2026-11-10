import { describe, expect, it } from "vitest";
import { Config, resolveToolToonConfig } from "../src/index.js";

describe("configuration", () => {
  it("exports a schema with the runtime defaults", () => {
    expect(Config({})).toEqual(resolveToolToonConfig());
  });
  it("clamps invalid bounds and deduplicates exact exclusions", () => {
    expect(
      resolveToolToonConfig({
        enabled: false,
        minBytes: Infinity,
        maxBytes: -1,
        minSavingsBytes: -1,
        minSavingsRatio: 3,
        excludeTools: ["read", "read", ""],
      }),
    ).toEqual({
      enabled: false,
      minBytes: 512,
      maxBytes: 512,
      minSavingsBytes: 1,
      minSavingsRatio: 0.9,
      excludeTools: ["read"],
    });
    expect(
      resolveToolToonConfig({
        minBytes: 999999,
        maxBytes: 512,
        minSavingsRatio: NaN,
      }).minBytes,
    ).toBe(512);
    expect(
      resolveToolToonConfig({ minSavingsBytes: NaN }).minSavingsBytes,
    ).toBe(96);
  });
});
