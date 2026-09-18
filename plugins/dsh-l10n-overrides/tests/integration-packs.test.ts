// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import example from "../src/packs/example.js";
import { translationPacks } from "../src/packs/index.js";
import "./integration.helpers.js";

describe("built-in translation packs", () => {
  it("exports the exact frozen example pack", () => {
    expect(translationPacks).toEqual([example]);
    expect(example).toEqual({
      id: "example-plugin-en",
      target: {
        package: "dsh-example-plugin",
        versions: ">=0.4.0 <1.0.0",
      },
      en: {
        "example.settings": {
          title: "Settings",
          enabled: "Enabled",
          server: "Server address",
          save: "Save",
        },
      },
      dom: [
        {
          scope: '[data-plugin="example-plugin"]',
          source: "设置",
          target: "Settings",
        },
      ],
      metadata: {
        sourceLanguage: "zh",
        description: "Example English translation pack",
      },
    });
    for (const value of [
      translationPacks,
      example,
      example.target,
      example.en,
      example.en["example.settings"],
      example.dom,
      example.dom[0],
      example.metadata,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
