import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";
import {
  DEFAULT_PLUGIN_CONFIG,
  REPAIR_RULE_IDS,
  resolvePluginConfig,
} from "../src/shared/config.js";

describe("UI Repair config", () => {
  it("applies conservative defaults through both schema and resolver", () => {
    expect(ConfigSchema({})).toMatchObject(DEFAULT_PLUGIN_CONFIG);
    expect(ConfigSchema({ ignore: [{ selector: ".intentional" }] }).ignore).toEqual([
      { selector: ".intentional" },
    ]);
    expect(resolvePluginConfig()).toEqual(DEFAULT_PLUGIN_CONFIG);
  });

  it("normalizes thresholds and removes empty ignore entries", () => {
    expect(
      resolvePluginConfig({
        autoConfidence: 2,
        dangerousConfidence: 0.5,
        ignore: [
          {},
          { plugin: " example-plugin ", rule: "R001" },
          { selector: "  .intentional-overflow  " },
        ],
      }),
    ).toMatchObject({
      autoConfidence: 1,
      dangerousConfidence: 1,
      ignore: [
        { plugin: "example-plugin", rule: "R001" },
        { selector: ".intentional-overflow" },
      ],
    });
  });

  it("never permits the risky repair threshold below 98 percent", () => {
    expect(resolvePluginConfig({ dangerousConfidence: 0 }).dangerousConfidence).toBe(
      0.98,
    );
  });

  it("accepts every implemented rule in persistent ignore policies", () => {
    expect(REPAIR_RULE_IDS).toEqual([
      "R001",
      "R002",
      "R003",
      "R004",
      "R005",
      "R006",
      "R007",
      "R008",
      "R009",
      "R010",
      "R011",
      "R012",
      "R013",
    ]);
    expect(
      ConfigSchema({ ignore: REPAIR_RULE_IDS.map((rule) => ({ rule })) }).ignore,
    ).toHaveLength(REPAIR_RULE_IDS.length);
  });
});
