import { describe, it, expect } from "vitest";
import { createLogger, hasCompatibleMajor, validateConfig } from "../src/index";

describe("createLogger", () => {
  it("should return an object with info, warn, and error methods", () => {
    const logger = createLogger("test");

    expect(logger).toHaveProperty("info");
    expect(logger).toHaveProperty("warn");
    expect(logger).toHaveProperty("error");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("should prefix messages with plugin name", () => {
    const logs: string[] = [];
    const warnLogs: string[] = [];
    const errorLogs: string[] = [];

    // Mock console methods to capture output
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    console.log = (...args) => logs.push(args.join(" "));
    console.warn = (...args) => warnLogs.push(args.join(" "));
    console.error = (...args) => errorLogs.push(args.join(" "));

    try {
      const logger = createLogger("my-plugin");
      logger.info("test message", { key: "value" });
      logger.warn("warning message");
      logger.error("error message", { code: 500 });

      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("[dsh:my-plugin] INFO");
      expect(logs[0]).toContain("test message");

      expect(warnLogs).toHaveLength(1);
      expect(warnLogs[0]).toContain("[dsh:my-plugin] WARN");
      expect(warnLogs[0]).toContain("warning message");

      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0]).toContain("[dsh:my-plugin] ERROR");
      expect(errorLogs[0]).toContain("error message");
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
  });
});

describe("hasCompatibleMajor", () => {
  it("should return true when actual major >= required major", () => {
    expect(hasCompatibleMajor("4.0.0", "4.0.0")).toBe(true);
    expect(hasCompatibleMajor("5.0.0", "4.0.0")).toBe(true);
    expect(hasCompatibleMajor("4.1.0", "4.0.0")).toBe(true);
  });

  it("should return false when actual major < required major", () => {
    expect(hasCompatibleMajor("3.9.0", "4.0.0")).toBe(false);
    expect(hasCompatibleMajor("3.0.0", "4.0.0")).toBe(false);
  });

  it("should return false for invalid version strings", () => {
    expect(hasCompatibleMajor("abc", "1.0.0")).toBe(false);
    expect(hasCompatibleMajor("1.0.0", "xyz")).toBe(false);
    expect(hasCompatibleMajor("", "")).toBe(false);
  });

  it("should handle partial version strings", () => {
    expect(hasCompatibleMajor("4", "4.0.0")).toBe(true);
    expect(hasCompatibleMajor("5", "4.0.0")).toBe(true);
    expect(hasCompatibleMajor("3", "4.0.0")).toBe(false);
  });
});

describe("validateConfig", () => {
  it("should return empty object for undefined optional fields", () => {
    const result = validateConfig(
      {},
      { name: "string", count: "number" } as Record<
        keyof { name?: string; count?: number },
        "string" | "number" | "boolean" | "object"
      >,
    );

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
      validateConfig(
        { meta: null },
        { meta: "object" } as Record<keyof { meta?: object }, "object">,
      ),
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
