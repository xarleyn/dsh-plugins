import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMORY_DB_FILE,
  DEFAULT_MEMORY_PROVIDER,
  DEFAULT_SUBAGENT_PROVIDER,
  SETTINGS_NAMESPACE,
  domainDraftDefaults,
  resolveConfig,
} from "../src/config.js";
import { ConfigSchema } from "../src/config.js";

/** Where a deployment that named no database puts its memory file. */
const defaultMemoryDbPath = (): string =>
  path.join(
    process.env.DSH_HOME?.trim() || process.cwd(),
    DEFAULT_MEMORY_DB_FILE,
  );

describe("config: defaults", () => {
  it("uses the documented defaults for an empty entry", () => {
    expect(resolveConfig()).toEqual({
      enabled: true,
      subagentProvider: DEFAULT_SUBAGENT_PROVIDER,
      defaultMaxDepth: 3,
      defaultMaxParallel: 3,
      defaultCrossDomainMode: "expert-only",
      defaultMemoryProvider: DEFAULT_MEMORY_PROVIDER,
      memoryDbPath: defaultMemoryDbPath(),
      recallLimit: 5,
      auditLimit: 200,
    });
  });

  it("exposes a settings namespace that DSH accepts", () => {
    expect(SETTINGS_NAMESPACE).toBe("domain-experts");
    expect(SETTINGS_NAMESPACE).toMatch(/^[a-z][a-z0-9-]*$/u);
  });

  it("declares every field with a default in the schema", () => {
    const resolved = ConfigSchema({}) as Record<string, unknown>;
    expect(Object.keys(resolved).sort()).toEqual([
      "auditLimit",
      "defaultCrossDomainMode",
      "defaultMaxDepth",
      "defaultMaxParallel",
      "defaultMemoryProvider",
      "enabled",
      "memoryDbPath",
      "recallLimit",
      "subagentProvider",
    ]);
  });
});

describe("config: overrides", () => {
  it("keeps explicit values", () => {
    const resolved = resolveConfig({
      enabled: false,
      subagentProvider: "fork",
      defaultMaxDepth: 5,
      defaultMaxParallel: 1,
      defaultCrossDomainMode: "direct-read",
      defaultMemoryProvider: "openviking",
      recallLimit: 12,
      auditLimit: 7,
    });
    expect(resolved).toMatchObject({
      enabled: false,
      subagentProvider: "fork",
      defaultMaxDepth: 5,
      defaultMaxParallel: 1,
      defaultCrossDomainMode: "direct-read",
      defaultMemoryProvider: "openviking",
      recallLimit: 12,
      auditLimit: 7,
    });
  });

  it("keeps a memory database the deployment names, trimmed", () => {
    expect(
      resolveConfig({ memoryDbPath: "  /var/lib/dsh/memory.db  " })
        .memoryDbPath,
    ).toBe("/var/lib/dsh/memory.db");
  });

  it("puts the memory database in the DSH home when one is set", () => {
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = "/home/dsh";
    try {
      expect(resolveConfig().memoryDbPath).toBe(
        path.join("/home/dsh", DEFAULT_MEMORY_DB_FILE),
      );
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    }
  });

  it("refuses an unknown cross-domain mode instead of narrowing it silently", () => {
    expect(() =>
      resolveConfig({ defaultCrossDomainMode: "wide-open" }),
    ).toThrowError(/defaultCrossDomainMode must be one of/u);
  });

  it("falls back for a non-finite or negative number", () => {
    const resolved = resolveConfig({
      recallLimit: Number.NaN,
      auditLimit: -5,
      defaultMaxDepth: -1,
    });
    expect(resolved.recallLimit).toBe(5);
    expect(resolved.auditLimit).toBe(200);
    expect(resolved.defaultMaxDepth).toBe(3);
  });

  it("keeps the audit ring non-empty", () => {
    expect(resolveConfig({ auditLimit: 0 }).auditLimit).toBe(1);
  });

  it("falls back for a blank provider name", () => {
    expect(resolveConfig({ subagentProvider: "   " }).subagentProvider).toBe(
      DEFAULT_SUBAGENT_PROVIDER,
    );
    expect(
      resolveConfig({ defaultMemoryProvider: "" }).defaultMemoryProvider,
    ).toBe(DEFAULT_MEMORY_PROVIDER);
  });
});

describe("config: draft defaults", () => {
  it("seeds a new domain from the plugin defaults", () => {
    const defaults = domainDraftDefaults(
      resolveConfig({ defaultMaxDepth: 4, defaultCrossDomainMode: "disabled" }),
    );
    expect(defaults).toEqual({ maxDepth: 4, crossDomainMode: "disabled" });
  });
});
