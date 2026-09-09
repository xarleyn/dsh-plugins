/**
 * Unit tests for config resolution (SPEC §13-§16, §23-§24; guidelines §6.2:
 * parsing/validation of empty and invalid config).
 */

import { describe, expect, it } from "vitest";

import { resolveToolOffloadConfig, TOOL_OFFLOAD_DEFAULTS } from "../../src/config.js";

describe("resolveToolOffloadConfig defaults", () => {
  it("fills every section from TOOL_OFFLOAD_DEFAULTS on empty config", () => {
    const config = resolveToolOffloadConfig({});
    expect(config.enabled).toBe(true);
    expect(config.routing.mode).toBe("allowlist");
    expect([...config.routing.allow]).toEqual([...TOOL_OFFLOAD_DEFAULTS.allow]);
    expect([...config.routing.deny]).toEqual([...TOOL_OFFLOAD_DEFAULTS.deny]);
    expect(config.routing.thresholds.minBytes).toBe(24_000);
    expect(config.routing.thresholds.minEstimatedTokens).toBe(6_000);
    expect(config.defaultWorker).toBe("default");
    expect(config.workers.default!.subagentProvider).toBe("spawn");
    expect(config.workers.default!.provider).toBeNull();
    expect(config.workers.default!.model).toBeNull();
    expect(config.workers.default!.maxTokens).toBe(4_000);
    expect(config.workers.default!.timeoutMs).toBe(45_000);
    expect(config.context.includeLastUserMessage).toBe(true);
    expect(config.context.maxParentContextBytes).toBe(12_000);
    expect(config.payload.maxBytes).toBe(300_000);
    expect(config.validation.maxOutputBytes).toBe(20_000);
    expect(config.validation.requireReduction).toBe(true);
    expect(config.validation.minReductionRatio).toBe(0.15);
    expect(config.fallback.mode).toBe("original");
    expect(config.annotation.enabled).toBe(false);
    expect(config.concurrency).toEqual({ maxWorkersPerAgent: 3, maxWorkersGlobal: 8 });
    expect(config.telemetry.enabled).toBe(true);
  });

  it("appends the built-in tool→prompt rules after user rules", () => {
    const config = resolveToolOffloadConfig({});
    expect(config.routing.rules.map((rule) => rule.id)).toEqual([
      "built-in:web-reader",
      "built-in:search-results",
      "built-in:code-reader",
    ]);
    expect(config.routing.rules.map((rule) => rule.prompt)).toEqual(["web-reader", "search-results", "code-reader"]);
    for (const rule of config.routing.rules) {
      expect(rule.worker).toBe("default");
      expect(rule.action).toBe("offload");
    }
  });
});

describe("resolveToolOffloadConfig workers", () => {
  it("merges custom worker profiles over the built-in defaults", () => {
    const config = resolveToolOffloadConfig({
      workers: { tiny: { provider: "zai", model: "glm-4.5-air", maxTokens: 2_500 } },
      defaultWorker: "tiny",
    });
    expect(config.workers.tiny).toEqual({
      subagentProvider: "spawn",
      provider: "zai",
      model: "glm-4.5-air",
      maxTokens: 2_500,
      timeoutMs: 45_000,
    });
    expect(config.defaultWorker).toBe("tiny");
  });

  it("rejects an unknown defaultWorker reference", () => {
    expect(() => resolveToolOffloadConfig({ defaultWorker: "missing" })).toThrowError(/unknown worker profile "missing"/);
  });

  it("rejects rules referencing unknown workers or prompts", () => {
    expect(() =>
      resolveToolOffloadConfig({
        routing: { rules: [{ id: "bad-worker", match: { tools: ["read"] }, worker: "missing" }] },
      }),
    ).toThrowError(/unknown worker profile "missing"/);
    expect(() =>
      resolveToolOffloadConfig({
        routing: { rules: [{ id: "bad-prompt", match: { tools: ["read"] }, prompt: "nope" }] },
      }),
    ).toThrowError(/unknown prompt profile "nope"/);
  });

  it("accepts custom prompt profiles defined in prompts", () => {
    const config = resolveToolOffloadConfig({
      prompts: { narrow: "- Keep only the answer to the question.\n" },
      routing: { rules: [{ id: "narrow-rule", match: { tools: ["web_fetch"] }, prompt: "narrow" }] },
    });
    expect(config.routing.rules[0]?.prompt).toBe("narrow");
    expect(config.prompts.narrow).toContain("Keep only the answer");
  });
});

describe("resolveToolOffloadConfig validation", () => {
  it("rejects non-positive thresholds, payload, and concurrency bounds", () => {
    expect(() => resolveToolOffloadConfig({ routing: { thresholds: { minBytes: 0 } } })).toThrowError(/minBytes/);
    expect(() => resolveToolOffloadConfig({ routing: { thresholds: { minEstimatedTokens: -1 } } })).toThrowError(/minEstimatedTokens/);
    expect(() => resolveToolOffloadConfig({ payload: { maxBytes: 512 } })).toThrowError(/payload\.maxBytes/);
    expect(() => resolveToolOffloadConfig({ concurrency: { maxWorkersGlobal: 0 } })).toThrowError(/maxWorkersGlobal/);
    expect(() => resolveToolOffloadConfig({ workers: { tiny: { timeoutMs: 10 } } })).toThrowError(/timeoutMs/);
  });

  it("rejects an unknown routing mode and empty tool patterns", () => {
    expect(() => resolveToolOffloadConfig({ routing: { mode: "smart" as never } })).toThrowError(/routing\.mode/);
    expect(() => resolveToolOffloadConfig({ routing: { allow: [""] } })).toThrowError(/non-empty tool patterns/);
  });

  it("rejects out-of-range reduction ratio and small output caps", () => {
    expect(() => resolveToolOffloadConfig({ validation: { minReductionRatio: 1.5 } })).toThrowError(/minReductionRatio/);
    expect(() => resolveToolOffloadConfig({ validation: { maxOutputBytes: 16 } })).toThrowError(/maxOutputBytes/);
  });
});
