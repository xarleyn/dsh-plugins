import { describe, expect, it } from "vitest";
import { matchesOptimizedRoute, resolveConfig } from "../src/shared/config.js";

describe("observer config", () => {
  it("uses a safe explicit Sleev prefix by default", () => {
    const config = resolveConfig();
    expect(matchesOptimizedRoute("sleev-openai", config)).toBe(true);
    expect(matchesOptimizedRoute("openai", config)).toBe(false);
  });

  it("supports exact routes and de-duplicates matchers", () => {
    const config = resolveConfig({
      routes: [" optimized ", "optimized"],
      routePrefixes: ["gw-", "gw-"],
    });
    expect(config.routes).toEqual(["optimized"]);
    expect(config.routePrefixes).toEqual(["gw-"]);
    expect(matchesOptimizedRoute("optimized", config)).toBe(true);
    expect(matchesOptimizedRoute("gw-model", config)).toBe(true);
  });

  it("rejects empty matchers and invalid bounds", () => {
    expect(() => resolveConfig({ routes: [" "] })).toThrow(/empty value/);
    expect(() => resolveConfig({ maxRecentCalls: 0 })).toThrow(/positive/);
  });
});
