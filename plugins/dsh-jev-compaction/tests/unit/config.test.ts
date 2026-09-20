import { describe, expect, it } from "vitest";
import { DEFAULTS, resolveJevCompactionConfig } from "../../src/config.js";

describe("resolveJevCompactionConfig", () => {
  it("resolves detached defaults for an empty config", () => {
    const resolved = resolveJevCompactionConfig({});
    expect(resolved.enabled).toBe(true);
    expect(resolved.jev).toEqual({
      model: "jev-latest",
      apiKeyEnv: "TYPESAFE_API_KEY",
      baseUrl: "https://api.typesafe.ai/v1/systemone",
      timeoutMs: 2500,
      maxConcurrency: 4,
      retries: 0,
    });
    expect(resolved.decisions).toEqual({
      fullThreshold: 0.7,
      truncateThreshold: 0.45,
    });
  });

  it("overrides nested values and clamps ranges", () => {
    const resolved = resolveJevCompactionConfig({
      enabled: false,
      jev: { timeoutMs: 1, maxConcurrency: 99, retries: 7 },
      trigger: { cooldownTurns: -3 },
    });
    expect(resolved.enabled).toBe(false);
    expect(resolved.jev.timeoutMs).toBe(500);
    expect(resolved.jev.maxConcurrency).toBe(8);
    expect(resolved.jev.retries).toBe(1);
    expect(resolved.trigger.cooldownTurns).toBe(0);
  });
  it("rejects non-finite scalars", () => {
    expect(() =>
      resolveJevCompactionConfig({ trigger: { contextRatio: Number.NaN } }),
    ).toThrow(/contextRatio/);
    expect(() =>
      resolveJevCompactionConfig({
        jev: { timeoutMs: Number.POSITIVE_INFINITY },
      }),
    ).toThrow(/timeoutMs/);
  });

  it("rejects inverted thresholds and out-of-range probabilities", () => {
    expect(() =>
      resolveJevCompactionConfig({
        decisions: { fullThreshold: 0.3, truncateThreshold: 0.6 },
      }),
    ).toThrow(/truncateThreshold/);
    expect(() =>
      resolveJevCompactionConfig({ decisions: { fullThreshold: 1.4 } }),
    ).toThrow(/fullThreshold/);
  });

  it("never leaks a key value: only the env var name is configured", () => {
    const json = JSON.stringify(DEFAULTS);
    expect(json).not.toMatch(/Bearer/i);
    expect(DEFAULTS.jev.apiKeyEnv).toBe("TYPESAFE_API_KEY");
  });

  it("resolves the typesafe provider preset by default", () => {
    const resolved = resolveJevCompactionConfig({});
    expect(resolved.decision.provider).toBe("typesafe");
    expect(resolved.jev.baseUrl).toBe("https://api.typesafe.ai/v1/systemone");
    expect(resolved.jev.apiKeyEnv).toBe("TYPESAFE_API_KEY");
  });

  it("switches to the self-hosted jeff preset by provider name", () => {
    const resolved = resolveJevCompactionConfig({
      decision: { provider: "jeff" },
    });
    expect(resolved.decision.provider).toBe("jeff");
    // The preset names the System One route, never a bare host: the client
    // POSTs to this URL as it stands.
    expect(resolved.jev.baseUrl).toBe("http://localhost:8000/v1/systemone");
    expect(resolved.jev.apiKeyEnv).toBe("JEFF_API_KEY");
    expect(resolved.jev.model).toBe("jev-latest");
  });

  it("lets decision.<provider> win over the legacy block the settings layer materializes", () => {
    // What a settings-driven deployment actually resolves: the namespace value
    // carries every shipped default, so `jev` is present without anyone having
    // written it. Honouring it would shadow decision.jeff.* — this is the bug
    // that made a self-hosted deployment ask for TYPESAFE_API_KEY.
    const resolved = resolveJevCompactionConfig({
      decision: {
        provider: "jeff",
        jeff: {
          baseUrl: "http://jeff:8000",
          apiKeyEnv: "JEFF_API_KEY",
        },
      },
      jev: { ...DEFAULTS.jev },
    });
    expect(resolved.jev.baseUrl).toBe("http://jeff:8000");
    expect(resolved.jev.apiKeyEnv).toBe("JEFF_API_KEY");
  });

  it("keeps an explicitly configured legacy block as an override", () => {
    const resolved = resolveJevCompactionConfig({
      decision: { provider: "jeff", jeff: { baseUrl: "http://jeff:8000" } },
      jev: { baseUrl: "http://legacy.example/v1/systemone" },
    });
    expect(resolved.jev.baseUrl).toBe("http://legacy.example/v1/systemone");
  });

  it("applies per-provider overrides over the preset", () => {
    const resolved = resolveJevCompactionConfig({
      decision: {
        provider: "jeff",
        jeff: { baseUrl: "http://jeff:8000", model: "jev-latest" },
      },
    });
    expect(resolved.jev.baseUrl).toBe("http://jeff:8000");
    expect(resolved.jev.apiKeyEnv).toBe("JEFF_API_KEY");
  });

  it("requires an explicit baseUrl for the custom provider", () => {
    expect(() =>
      resolveJevCompactionConfig({ decision: { provider: "custom" } }),
    ).toThrow(/decision\.custom\.baseUrl/);
    const resolved = resolveJevCompactionConfig({
      decision: {
        provider: "custom",
        custom: { baseUrl: "http://openjev:8000", apiKeyEnv: "" },
      },
    });
    expect(resolved.jev.baseUrl).toBe("http://openjev:8000");
    expect(resolved.jev.apiKeyEnv).toBe("");
  });

  it("takes transport budgets from the decision block", () => {
    const resolved = resolveJevCompactionConfig({
      decision: { timeoutMs: 4000, maxConcurrency: 2, retries: 1 },
    });
    expect(resolved.jev.timeoutMs).toBe(4000);
    expect(resolved.jev.maxConcurrency).toBe(2);
    expect(resolved.jev.retries).toBe(1);
  });

  it("lets the legacy flat jev block override the resolved preset", () => {
    const resolved = resolveJevCompactionConfig({
      decision: { provider: "jeff" },
      jev: { baseUrl: "http://override:9000" },
    });
    expect(resolved.decision.provider).toBe("jeff");
    expect(resolved.jev.baseUrl).toBe("http://override:9000");
    expect(resolved.jev.apiKeyEnv).toBe("JEFF_API_KEY");
  });

  it("rejects an unknown provider", () => {
    const raw = { decision: { provider: "unknown" as never } };
    expect(() => resolveJevCompactionConfig(raw)).toThrow(/decision\.provider/);
  });
});
