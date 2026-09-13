/**
 * Live settings integration: the gate's namespace is installed as a live
 * section, and a committed write re-resolves the running gate — the behaviour
 * the settings card depends on.
 */

import { Context } from "@deepseek-ai/cordis";
import SettingsProvider, { type SettingsNamespace } from "@deepseek-ai/dsh-settings";
import { describe, expect, it, vi } from "vitest";

import ModelSafetyGate from "../../src/index.js";
import { SAFETY_GATE_SETTINGS_NAMESPACE } from "../../src/shared/settings.js";

/** In-memory settings provider: the smallest host the install path needs. */
class MemorySettings extends SettingsProvider {
  private readonly storageDocument: Record<string, unknown>;
  override readonly writable = true;

  constructor(ctx: Context, document: Record<string, unknown> = {}) {
    super(ctx);
    this.storageDocument = structuredClone(document);
  }

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.storageDocument));
  }

  protected override persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.storageDocument[ns] = structuredClone(section);
    return Promise.resolve();
  }
}

async function configuredContext(
  entry: Record<string, unknown> = {},
  document: Record<string, unknown> = {},
): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(MemorySettings, document);
  await ctx.plugin(ModelSafetyGate, entry);
  return ctx;
}

describe("safety gate live settings", () => {
  it("registers the namespace as a live section", async () => {
    const ctx = await configuredContext();
    const descriptor = ctx.settings
      .describe()
      .find((item) => item.ns === SAFETY_GATE_SETTINGS_NAMESPACE);
    expect(descriptor).toMatchObject({
      ns: "model-safety-gate",
      applies: "live",
      revision: 0,
    });
  });

  it("resolves the composition entry while no user layer exists", async () => {
    const ctx = await configuredContext({ mode: "audit", enabled: true });
    expect(ctx.safetyGate.config.mode).toBe("audit");
    expect(ctx.safetyGate.inspect().mode).toBe("audit");
  });

  it("re-resolves the running gate after a committed change", async () => {
    const ctx = await configuredContext({ mode: "warn" });
    expect(ctx.safetyGate.config.mode).toBe("warn");

    await ctx.settings.update(SAFETY_GATE_SETTINGS_NAMESPACE, { mode: "enforce" });
    await vi.waitFor(() => {
      expect(ctx.safetyGate.config.mode).toBe("enforce");
    });
    expect(ctx.safetyGate.inspect().enabled).toBe(true);
    expect(ctx.safetyGate.inspect().mode).toBe("enforce");
  });

  it("applies a nested section write to the running gate", async () => {
    const ctx = await configuredContext();
    expect(ctx.safetyGate.config.output.mode).toBe("buffered");

    await ctx.settings.update(SAFETY_GATE_SETTINGS_NAMESPACE, {
      output: { mode: "observe" },
      customBlockPatterns: ["internal-ticket-[0-9]+"],
    });
    await vi.waitFor(() => {
      expect(ctx.safetyGate.config.output.mode).toBe("observe");
    });
    expect(ctx.safetyGate.config.customBlockPatterns).toEqual(["internal-ticket-[0-9]+"]);
    // Untouched keys of the same section keep their resolved defaults.
    expect(ctx.safetyGate.config.output.checkEveryChars).toBe(512);
  });

  it("refuses a configuration the gate could not act on", async () => {
    const ctx = await configuredContext({ mode: "warn" });
    await expect(
      ctx.settings.update(SAFETY_GATE_SETTINGS_NAMESPACE, { classifier: { backend: "dsh" } }),
    ).rejects.toThrow(/provider/u);
    await vi.waitFor(() => {
      expect(ctx.safetyGate.config.mode).toBe("warn");
    });
    expect(ctx.safetyGate.config.classifier.backend).toBe("none");
  });

  it("keeps the gate out of the way when no settings provider is mounted", async () => {
    const ctx = new Context();
    await ctx.plugin(ModelSafetyGate, { mode: "enforce" });
    // No provider: the composition entry stays authoritative.
    expect(ctx.safetyGate.config.mode).toBe("enforce");
  });
});
