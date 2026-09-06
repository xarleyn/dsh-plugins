import { describe, expect, it } from "vitest";
import { KV_PERSIST_DEFAULTS, isManagedProvider, resolveKvPersistConfig } from "../../src/config.js";
import { compatibilityVersion } from "../../src/snapshots/fingerprint.js";

describe("resolveKvPersistConfig", () => {
  it("applies the SPEC §36 defaults", () => {
    const config = resolveKvPersistConfig({});
    expect(config.enabled).toBe(true);
    expect(config.baseURL).toBe("http://127.0.0.1:8080");
    expect(config.mode).toBe("single-slot");
    expect(config.slotId).toBe(0);
    expect(config.checkpoint.onSwitch).toBe(true);
    expect(config.checkpoint.onShutdown).toBe(true);
    expect(config.checkpoint.onSessionFlush).toBe(true);
    expect(config.checkpoint.idleMs).toBe(KV_PERSIST_DEFAULTS.idleMs);
    expect(config.checkpoint.onTurnEnd).toBe(false);
    expect(config.checkpoint.onStepEnd).toBe(false);
    expect(config.restore.enabled).toBe(true);
    expect(config.restore.verify).toBe(true);
    expect(config.failure.strict).toBe(false);
    expect(config.failure.maxConsecutiveFailures).toBe(3);
    expect(config.failure.cooldownMs).toBe(60_000);
    expect(config.requestTimeoutMs).toBe(15_000);
    expect(config.providers).toEqual([]);
  });

  it("strips trailing slashes from baseURL", () => {
    const config = resolveKvPersistConfig({ backend: { baseURL: "http://h:1/" } });
    expect(config.baseURL).toBe("http://h:1");
  });

  it("keeps an explicit api key private but present", () => {
    const config = resolveKvPersistConfig({ backend: { apiKey: "secret" } });
    expect(config.apiKey).toBe("secret");
    const blank = resolveKvPersistConfig({ backend: { apiKey: "" } });
    expect(blank.apiKey).toBeNull();
  });

  it("rejects managed-slots in v0.1 (SPEC §8, §68)", () => {
    expect(() => resolveKvPersistConfig({ mode: "managed-slots" })).toThrowError(/managed-slots/);
  });

  it("rejects non-integer or negative numeric options", () => {
    expect(() => resolveKvPersistConfig({ slotId: -1 })).toThrowError(/slotId/);
    expect(() => resolveKvPersistConfig({ checkpoint: { idleMs: 1.5 } })).toThrowError(/idleMs/);
    expect(() => resolveKvPersistConfig({ failure: { maxConsecutiveFailures: 0 } })).toThrowError(
      /maxConsecutiveFailures/,
    );
  });

  it("filters blank managed providers (SPEC §37)", () => {
    const config = resolveKvPersistConfig({ providers: ["local-qwen", "", "local-coder"] });
    expect(config.providers).toEqual(["local-qwen", "local-coder"]);
  });

  it("matches only explicitly managed providers", () => {
    const config = resolveKvPersistConfig({ providers: ["local-qwen"] });
    expect(isManagedProvider(config, "local-qwen")).toBe(true);
    expect(isManagedProvider(config, "deepseek")).toBe(false);
    expect(isManagedProvider(config, "openai")).toBe(false);
  });
});

describe("compatibilityVersion (SPEC §15)", () => {
  it("is stable for identical inputs", () => {
    const a = compatibilityVersion({ backend: "llama.cpp", runtimeKey: "rt", model: "m" });
    const b = compatibilityVersion({ backend: "llama.cpp", runtimeKey: "rt", model: "m" });
    expect(a).toBe(b);
  });

  it("changes when the runtimeKey escape hatch changes", () => {
    const a = compatibilityVersion({ backend: "llama.cpp", runtimeKey: "rt-1", model: "m" });
    const b = compatibilityVersion({ backend: "llama.cpp", runtimeKey: "rt-2", model: "m" });
    expect(a).not.toBe(b);
  });

  it("changes when the model changes", () => {
    const a = compatibilityVersion({ backend: "llama.cpp", runtimeKey: "rt", model: "m1" });
    const b = compatibilityVersion({ backend: "llama.cpp", runtimeKey: "rt", model: "m2" });
    expect(a).not.toBe(b);
  });

  it("treats a missing runtimeKey like the empty key", () => {
    const a = compatibilityVersion({ backend: "llama.cpp", runtimeKey: null, model: "m" });
    const b = compatibilityVersion({ backend: "llama.cpp", runtimeKey: "", model: "m" });
    expect(a).toBe(b);
  });
});
