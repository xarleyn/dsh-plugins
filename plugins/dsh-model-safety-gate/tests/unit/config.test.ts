import { describe, expect, it } from "vitest";

import { ModelSafetyGateConfigSchema, resolveSafetyGateConfig, SAFETY_GATE_DEFAULTS } from "../../src/config.js";
import { SafetyGateError } from "../../src/types.js";

describe("resolveSafetyGateConfig", () => {
  it("resolves defaults for empty config", () => {
    const config = resolveSafetyGateConfig({});
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe("warn");
    expect(config.classifier.backend).toBe("none");
    expect(config.classifier.failureMode).toBe("rules-only");
    expect(config.input.safetyAction).toBe("block");
    expect(config.input.qualityAction).toBe("warn");
    expect(config.output.mode).toBe("buffered");
    expect(config.output.checkEveryChars).toBe(512);
    expect(config.output.windowChars).toBe(1_536);
    expect(config.output.lookbehindChars).toBe(768);
    expect(config.output.maxBufferedChars).toBe(8_192);
    expect(config.audit.includeRawContent).toBe(false);
    expect(config.allowSessionOverride).toBe(true);
  });

  it("accepts the schema object shape", () => {
    const parsed = ModelSafetyGateConfigSchema({ mode: "enforce" });
    expect(parsed.mode).toBe("enforce");
  });

  it("rejects unknown mode values", () => {
    expect(() => resolveSafetyGateConfig({ mode: "yolo" as never })).toThrow(SafetyGateError);
    try {
      resolveSafetyGateConfig({ mode: "yolo" as never });
    } catch (error) {
      expect((error as SafetyGateError).code).toBe("SAFETY_INVALID_ARGUMENT");
    }
  });

  it("requires provider and model for the dsh backend", () => {
    expect(() => resolveSafetyGateConfig({ classifier: { backend: "dsh" } })).toThrow(SafetyGateError);
    expect(() =>
      resolveSafetyGateConfig({ classifier: { backend: "dsh", provider: "local", model: "safety-small" } }),
    ).not.toThrow();
  });

  it("requires baseURL for the openai-compatible backend", () => {
    expect(() => resolveSafetyGateConfig({ classifier: { backend: "openai-compatible" } })).toThrow(SafetyGateError);
    expect(() =>
      resolveSafetyGateConfig({ classifier: { backend: "openai-compatible", baseURL: "http://127.0.0.1:8000/v1" } }),
    ).not.toThrow();
  });

  it("requireLocal forbids remote backends at load time", () => {
    expect(() =>
      resolveSafetyGateConfig({
        classifier: { backend: "openai-compatible", baseURL: "https://safety.example.com/v1", requireLocal: true },
      }),
    ).toThrow(SafetyGateError);
    expect(() => resolveSafetyGateConfig({ classifier: { requireLocal: true } })).not.toThrow();
  });

  it("rejects invalid custom patterns loudly", () => {
    expect(() => resolveSafetyGateConfig({ customBlockPatterns: ["([bad"] })).toThrow(SafetyGateError);
    const config = resolveSafetyGateConfig({ customBlockPatterns: ["internal[-_]codename"] });
    expect(config.customBlockPatterns).toEqual(["internal[-_]codename"]);
  });

  it("validates streaming window bounds", () => {
    expect(() => resolveSafetyGateConfig({ output: { windowChars: 10 } })).toThrow(SafetyGateError);
    expect(() => resolveSafetyGateConfig({ output: { maxBufferedChars: 100 } })).toThrow(SafetyGateError);
  });

  it("keeps defaults stable", () => {
    expect(SAFETY_GATE_DEFAULTS.maxTokens).toBe(128);
    expect(SAFETY_GATE_DEFAULTS.temperature).toBe(0);
    expect(SAFETY_GATE_DEFAULTS.timeoutMs).toBe(3_000);
  });
});
