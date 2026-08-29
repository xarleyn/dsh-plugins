import { describe, expect, it } from "vitest";
import { createMockContext, createLogger } from "../src/index";

describe("createMockContext", () => {
  it("should return a context with default values", () => {
    const ctx = createMockContext();

    expect(ctx).toEqual({
      pluginName: "test-plugin",
      config: {},
      loaded: false,
    });
  });

  it("should merge overrides into defaults", () => {
    const ctx = createMockContext({
      pluginName: "my-plugin",
      loaded: true,
    });

    expect(ctx.pluginName).toBe("my-plugin");
    expect(ctx.config).toEqual({});
    expect(ctx.loaded).toBe(true);
  });

  it("should allow full override of all fields", () => {
    const ctx = createMockContext({
      pluginName: "custom",
      config: { key: "value" },
      loaded: true,
    });

    expect(ctx.pluginName).toBe("custom");
    expect(ctx.config).toEqual({ key: "value" });
    expect(ctx.loaded).toBe(true);
  });
});

describe("createLogger (re-exported)", () => {
  it("should be available from test-kit", () => {
    const logger = createLogger("test");

    expect(logger).toHaveProperty("info");
    expect(typeof logger.info).toBe("function");
  });
});
