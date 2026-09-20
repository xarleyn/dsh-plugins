/**
 * Host-side settings section (result-shaping SPEC §34, §56).
 *
 * The section is the only writer of the plugin's live configuration, so these
 * tests pin the layering (composition entry as the base, user settings on top),
 * the live re-apply on change, and the refusal of values the schema cannot
 * express.
 */

import { describe, expect, it } from "vitest";

import { resolveJevCompactionConfig } from "../../src/config.js";
import type { JevCompactionConfig } from "../../src/config.js";
import { installJevCompactionSettings } from "../../src/settings/install.js";
import { JEV_COMPACTION_SETTINGS_NAMESPACE } from "../../src/shared/settings.js";

interface Installed {
  readonly owner: unknown;
  readonly namespace: string;
  readonly schema: unknown;
  readonly entry: unknown;
  readonly hooks: {
    setSource(current: () => JevCompactionConfig): void;
    onChange(): void;
    validate?(value: JevCompactionConfig): void;
  };
}

/** Minimal host context: `inject` runs its callback with a settings service. */
function fakeHost(options: { withSettings: boolean }): {
  owner: unknown;
  installed: Installed[];
} {
  const installed: Installed[] = [];
  const settings = {
    installSection(
      owner: unknown,
      namespace: string,
      schema: unknown,
      entry: unknown,
      hooks: Installed["hooks"],
    ): void {
      installed.push({ owner, namespace, schema, entry, hooks });
    },
  };
  const owner = {
    inject(
      services: readonly string[],
      callback: (ctx: unknown) => void,
    ): void {
      if (!options.withSettings || !services.includes("settings")) {
        callback({});
        return;
      }
      callback({ settings });
    },
  };
  return { owner, installed };
}

const ENTRY: JevCompactionConfig = {
  enabled: true,
  decision: { provider: "typesafe" },
};

function install(options: { withSettings: boolean }) {
  const host = fakeHost(options);
  let source: () => JevCompactionConfig = () => ENTRY;
  let changes = 0;
  installJevCompactionSettings({
    owner: host.owner as never,
    entryConfig: ENTRY,
    schema: { marker: "schema" },
    setSource: (current) => {
      source = current;
    },
    onChange: () => {
      changes += 1;
    },
    validate: (value) => {
      resolveJevCompactionConfig(value);
    },
  });
  return {
    installed: host.installed,
    current: () => source(),
    changes: () => changes,
  };
}

describe("installJevCompactionSettings", () => {
  it("registers the section under the plugin's own namespace", () => {
    const { installed } = install({ withSettings: true });
    expect(installed).toHaveLength(1);
    expect(installed[0]!.namespace).toBe(JEV_COMPACTION_SETTINGS_NAMESPACE);
    expect(installed[0]!.namespace).toBe("jev-compaction");
  });

  it("passes the composition entry as the base layer", () => {
    const { installed } = install({ withSettings: true });
    expect(installed[0]!.entry).toBe(ENTRY);
    expect(installed[0]!.schema).toEqual({ marker: "schema" });
  });

  it("stays inert when the host exposes no settings service", () => {
    const { installed, current, changes } = install({ withSettings: false });
    expect(installed).toHaveLength(0);
    // The plugin keeps running on its composition configuration.
    expect(current()).toBe(ENTRY);
    expect(changes()).toBe(0);
  });

  it("adopts the settings-driven source and reports the change", () => {
    const { installed, current, changes } = install({ withSettings: true });
    const hooks = installed[0]!.hooks;
    const userValue: JevCompactionConfig = {
      enabled: true,
      resultShaping: { enabled: true },
    };
    hooks.setSource(() => userValue);
    hooks.onChange();
    expect(current()).toBe(userValue);
    expect(changes()).toBe(1);
  });

  it("rejects a value the schema cannot express before it is persisted", () => {
    const { installed } = install({ withSettings: true });
    const validate = installed[0]!.hooks.validate;
    expect(validate).toBeDefined();
    expect(() =>
      validate!({ decisions: { fullThreshold: 0.2, truncateThreshold: 0.9 } }),
    ).toThrow(/truncateThreshold/u);
    expect(() => validate!({ trigger: { contextRatio: 2 } })).toThrow(
      /contextRatio/u,
    );
    expect(() => validate!({})).not.toThrow();
  });
});

describe("live configuration", () => {
  it("resolves user settings over the composition default", () => {
    const base = resolveJevCompactionConfig({
      resultShaping: { enabled: false, thresholdChars: 20000 },
    });
    const overridden = resolveJevCompactionConfig({
      ...base,
      resultShaping: { ...base.resultShaping, enabled: true },
    });
    expect(base.resultShaping.enabled).toBe(false);
    expect(base.resultShaping.thresholdChars).toBe(20000);
    expect(overridden.resultShaping.enabled).toBe(true);
    // Untouched fields keep their resolved value.
    expect(overridden.resultShaping.thresholdChars).toBe(20000);
    expect(overridden.jev.baseUrl).toBe(base.jev.baseUrl);
  });

  it("defaults shaping off so the destructive path needs a deliberate opt-in", () => {
    const config = resolveJevCompactionConfig({});
    expect(config.resultShaping.enabled).toBe(false);
    expect(config.archive.enabled).toBe(true);
    expect(config.resultShaping.preserveErrors).toBe(true);
    expect(config.resultShaping.maxPerTurn).toBe(2);
    expect(config.resultShaping.minClassificationConfidence).toBe(0.6);
    expect(config.resultShaping.includeTools).toContain("bash");
    expect(config.resultShaping.excludeTools).toEqual([]);
  });

  it("normalizes tool lists and refuses to inherit a blank entry", () => {
    const config = resolveJevCompactionConfig({
      resultShaping: { includeTools: [" bash ", "bash", "", "  ", "pwsh"] },
    });
    expect(config.resultShaping.includeTools).toEqual(["bash", "pwsh"]);
  });

  it("keeps the deployment default when a list is absent", () => {
    const config = resolveJevCompactionConfig({ resultShaping: {} });
    expect(config.resultShaping.includeTools).toContain("run_tests");
  });
});
