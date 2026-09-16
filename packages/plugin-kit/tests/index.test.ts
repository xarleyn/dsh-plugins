import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/index";

describe("validateConfig", () => {
  it("should return empty object for undefined optional fields", () => {
    const result = validateConfig({}, {
      name: "string",
      count: "number",
    } as Record<
      keyof { name?: string; count?: number },
      "string" | "number" | "boolean" | "object"
    >);

    expect(result).toEqual({});
  });

  it("should validate correct types", () => {
    const result = validateConfig(
      { name: "test", count: 42, enabled: true, meta: {} },
      {
        name: "string",
        count: "number",
        enabled: "boolean",
        meta: "object",
      } as Record<
        keyof {
          name?: string;
          count?: number;
          enabled?: boolean;
          meta?: object;
        },
        "string" | "number" | "boolean" | "object"
      >,
    );

    expect(result).toEqual({
      name: "test",
      count: 42,
      enabled: true,
      meta: {},
    });
  });

  it("should throw on wrong type", () => {
    expect(() =>
      validateConfig(
        { name: 123 } as Record<string, unknown>,
        { name: "string" } as Record<keyof { name?: string }, "string">,
      ),
    ).toThrow('Invalid type for "name": expected string, got number');
  });

  it("should reject null for object fields", () => {
    expect(() =>
      validateConfig({ meta: null }, { meta: "object" } as Record<
        keyof { meta?: object },
        "object"
      >),
    ).toThrow('Invalid type for "meta": expected object, got null');
  });

  it("should throw when config is not an object", () => {
    expect(() =>
      validateConfig(null as unknown as Record<string, unknown>, {}),
    ).toThrow("Configuration must be an object");

    expect(() =>
      validateConfig("string" as unknown as Record<string, unknown>, {}),
    ).toThrow("Configuration must be an object");

    expect(() =>
      validateConfig(42 as unknown as Record<string, unknown>, {}),
    ).toThrow("Configuration must be an object");
  });
});
