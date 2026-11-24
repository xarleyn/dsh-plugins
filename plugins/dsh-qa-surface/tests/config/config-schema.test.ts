import Schema from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import { ConfigSchema, readConfigRefs } from "../../src/config.js";
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

  it("validates a repeat rule on the Host and orders thresholds by call number", () => {
    const rule = {
      tool: "demo_lookup",
      thresholds: [
        { calls: 4, action: "finish", message: "Summarize the results." },
        { calls: 2, action: "warn", message: "Use the earlier result." },
      ],
    };
    const config = resolveConfig(schemaParse({ tools: { loopRules: [rule] } }));
    const mirror = new Schema(JSON.parse(JSON.stringify(ConfigSchema)));
    expect(
      mirror["~standard"].validate({ tools: config.tools }),
    ).toHaveProperty("value");
    expect(config.tools.loopRules).toEqual([
      {
        ...rule,
        maxDifferencePercent: 0,
        thresholds: [...rule.thresholds].reverse(),
      },
    ]);
    for (const loopRules of [
      [rule, rule],
      [{ ...rule, maxDifferencePercent: 101 }],
      [{ ...rule, thresholds: [rule.thresholds[1], rule.thresholds[1]] }],
      [
        {
          ...rule,
          thresholds: [{ calls: 2, action: "finish", message: "Summarize." }],
        },
      ],
      [{ ...rule, thresholds: [{ calls: 3, action: "block" }] }],
    ]) {
      expect(
        ConfigSchema["~standard"].validate({ tools: { loopRules } }),
      ).toHaveProperty("issues");
    }
    expect(
      resolveConfig(schemaParse({ tools: { loopRules: [] } })).tools.loopRules,
    ).toEqual([]);
  });

  it("preserves the operator's Markdown and uses the built-in guide for blank text", () => {
    const guide = (usageGuideMarkdown: string) =>
      resolveConfig(schemaParse({ branding: { usageGuideMarkdown } })).branding
        .usageGuideMarkdown;
    expect(guide("    пример\r\n\r\n## Проверка")).toBe(
      "    пример\n\n## Проверка",
    );
    expect(guide(" \n ")).toBe(
      DEFAULT_QA_SURFACE_CONFIG.branding.usageGuideMarkdown,
    );
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
