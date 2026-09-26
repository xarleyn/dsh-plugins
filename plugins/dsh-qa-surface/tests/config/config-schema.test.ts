import { describe, expect, it } from "vitest";
import { readConfigRefs } from "../../src/config.js";
import {
  DEFAULT_QA_SURFACE_CONFIG,
  resolveConfig,
} from "../../src/resolve-config.js";
import { schemaParse, schemaRefs } from "./config.helpers.js";

describe("ConfigSchema defaults", () => {
  // The host materializes schema defaults before resolveConfig sees the
  // config, so a schema-only default would reach the resolver as an explicit
  // value; these tests pin the schema against the canonical defaults.
  it("resolves schema-materialized defaults to the canonical config", () => {
    for (const input of [undefined, {}]) {
      expect(resolveConfig(schemaParse(input))).toEqual(
        DEFAULT_QA_SURFACE_CONFIG,
      );
    }
  });

  it("carries operator phrases through the schema into the resolved config", () => {
    expect(
      resolveConfig(schemaParse({ thinkingPhrases: [" Точу ", "Точу"] }))
        .thinkingPhrases,
    ).toEqual(["Точу"]);
  });

  it("keeps reported-source validation on until the deployment turns it off", () => {
    expect(resolveConfig().sources.subagents.validateReportedSources).toBe(
      true,
    );
    expect(
      resolveConfig(
        schemaParse({
          sources: { subagents: { validateReportedSources: false } },
        }),
      ).sources.subagents.validateReportedSources,
    ).toBe(false);
  });

  it("keeps ui.showReset off until lockdown authorizes it", () => {
    expect(resolveConfig(schemaParse(undefined)).ui.showReset).toBe(false);
    expect(() => resolveConfig({ ui: { showReset: true } })).toThrow(
      /allowSessionReset/u,
    );
    expect(
      resolveConfig(
        schemaParse({
          ui: { showReset: true },
          lockdown: { allowSessionReset: true },
        }),
      ).ui.showReset,
    ).toBe(true);
  });

  it("leaves the card no field it cannot write", () => {
    // The Host derives the configuration form, and refuses a write to a path
    // whose nearest volatile ancestor is missing, so every field the card edits
    // has to arrive from the schema as a reference.
    for (const [key, value] of Object.entries(schemaRefs(undefined))) {
      expect(typeof (value as { get?: unknown })?.get, key).toBe("function");
    }
  });

  it("reads the value the Host holds now, not the one the entry booted with", () => {
    let path = "/ask";
    const refs = {
      route: { get: () => ({ path, matchChildren: true }) },
    } as never;
    expect(resolveConfig(readConfigRefs(refs)).route.path).toBe("/ask");
    path = "/help";
    expect(resolveConfig(readConfigRefs(refs)).route.path).toBe("/help");
  });
});
