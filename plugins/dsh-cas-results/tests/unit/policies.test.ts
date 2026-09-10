/** Unit tests for per-tool transformation policies (SPEC §21, §22). */

import { describe, expect, it } from "vitest";

import { isOwnToolName, resolveToolPolicy } from "../../src/integration/policies.js";
import { resolveCasResultsConfig } from "../../src/config.js";

describe("isOwnToolName", () => {
  it("matches every dsh_cas_* tool (SPEC §21)", () => {
    for (const name of ["dsh_cas_retrieve", "dsh_cas_search", "dsh_cas_info", "dsh_cas_stats", "dsh_cas_gc"]) {
      expect(isOwnToolName(name)).toBe(true);
    }
    expect(isOwnToolName("bash")).toBe(false);
    expect(isOwnToolName("cas_helper")).toBe(false);
  });
});

describe("resolveToolPolicy", () => {
  it("resolves the default policy for ordinary tools", () => {
    const config = resolveCasResultsConfig({});
    const policy = resolveToolPolicy(config, "bash");
    expect(policy).not.toBeNull();
    expect(policy?.thresholds.textBytes).toBe(16_384);
    expect(policy?.previewStyle).toBe("auto");
  });

  it("bypasses own tools and excluded tools", () => {
    const config = resolveCasResultsConfig({});
    expect(resolveToolPolicy(config, "dsh_cas_retrieve")).toBeNull();
    expect(resolveToolPolicy(config, "edit")).toBeNull();
  });

  it("honors per-tool overrides", () => {
    const config = resolveCasResultsConfig({
      excludeTools: ["custom-write"],
      tools: {
        bash: { thresholdBytes: 4_096, preview: "log" },
        screenshot: { base64: true },
        noisy: { disabled: true },
      },
    });
    const bash = resolveToolPolicy(config, "bash");
    expect(bash?.thresholds.textBytes).toBe(4_096);
    expect(bash?.thresholds.htmlBytes).toBe(4_096);
    expect(bash?.previewStyle).toBe("log");

    const screenshot = resolveToolPolicy(config, "screenshot");
    expect(screenshot?.base64.enabled).toBe(true);

    expect(resolveToolPolicy(config, "noisy")).toBeNull();
    expect(resolveToolPolicy(config, "custom-write")).toBeNull();
  });

  it("propagates the global base64 toggle", () => {
    const config = resolveCasResultsConfig({ base64: { enabled: false } });
    expect(resolveToolPolicy(config, "bash")?.base64.enabled).toBe(false);
  });
});
