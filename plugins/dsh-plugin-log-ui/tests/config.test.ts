import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLUGIN_LOG_UI_CONFIG,
  resolveConfig,
} from "../src/config.js";

describe("plugin log UI config", () => {
  it("defaults to readable text and info", () => {
    expect(resolveConfig()).toEqual(DEFAULT_PLUGIN_LOG_UI_CONFIG);
  });

  it("resolves per-plugin overrides", () => {
    expect(resolveConfig({
      defaultLevel: "warn",
      format: "json",
      levels: {
        "dsh-kv-persist": "debug",
        "dsh-doc-impact": "error",
      },
    })).toEqual({
      defaultLevel: "warn",
      format: "json",
      levels: {
        "dsh-kv-persist": "debug",
        "dsh-doc-impact": "error",
      },
    });
  });

  it("rejects invalid plugin ids and values at runtime", () => {
    expect(() => resolveConfig({ levels: { "bad id": "info" } }))
      .toThrow("plugin log override id is invalid");
    expect(() => resolveConfig({ format: "pretty" as "text" }))
      .toThrow("plugin log format is invalid");
  });
});
