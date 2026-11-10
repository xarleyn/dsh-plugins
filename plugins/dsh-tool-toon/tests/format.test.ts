import { Buffer } from "node:buffer";
import { decode } from "@toon-format/toon";
import { describe, expect, it } from "vitest";
import { formatJsonText, resolveToolToonConfig } from "../src/index.js";

const config = resolveToolToonConfig();
export const fields = {
  items: Array.from({ length: 100 }, (_, i) => ({
    id: `customfield_${10000 + i}`,
    name: `Demo field ${i}`,
    custom: true,
    type: "option",
    navigable: true,
    searchable: true,
    orderable: true,
  })),
};

describe("lossless TOON conversion", () => {
  it("shrinks a Jira-shaped field catalogue and retains every row", () => {
    const json = JSON.stringify(fields);
    const text = formatJsonText(json, config)!;
    expect(text).toMatch(/^```toon\nitems\[100\]/u);
    expect(decode(text.split("\n").slice(1, -1).join("\n"))).toEqual(fields);
    expect(Buffer.byteLength(text)).toBeLessThan(Buffer.byteLength(json) * 0.6);
  });

  it.each([
    "comma,value",
    "colon: value",
    "line\nbreak",
    'quote"value',
    " leading ",
    "null",
    "true",
    "42",
    "```",
    "``````",
    "Демо-поле",
  ])("preserves escaped string %j and fences safely", (name) => {
    const value = {
      items: Array.from({ length: 30 }, () => ({
        name,
        value: null,
        active: false,
        nested: { count: 0 },
      })),
    };
    const text = formatJsonText(JSON.stringify(value), config)!;
    expect(text).not.toBeNull();
    expect(decode(text.split("\n").slice(1, -1).join("\n"))).toEqual(value);
    expect(formatJsonText(text, config)).toBeNull();
    if (name.startsWith("```"))
      expect(text.split("\n")[0]!.length).toBeGreaterThan(name.length);
  });

  it.each(["{}", "[]", "plain text", "[invalid", '"scalar"', "123", "null"])(
    "bypasses %s",
    (text) => {
      expect(formatJsonText(text, { ...config, minBytes: 0 })).toBeNull();
    },
  );

  it.each([
    "9007199254740993",
    "-0",
    "1e999",
    "1.0000000000000001",
    "0.1234567890123456789",
  ])("bypasses unsupported number %s", (number) => {
    expect(
      formatJsonText(
        `{"items":${JSON.stringify(fields.items)},"number":${number}}`,
        config,
      ),
    ).toBeNull();
  });

  it("does not count pretty-print whitespace as a TOON advantage", () => {
    expect(
      formatJsonText(
        JSON.stringify({ text: "x".repeat(1000) }, null, 10),
        config,
      ),
    ).toBeNull();
  });

  it("enforces size and savings bounds", () => {
    const text = JSON.stringify(fields);
    expect(formatJsonText(text, { ...config, maxBytes: 512 })).toBeNull();
    expect(formatJsonText(text, { ...config, minBytes: 100000 })).toBeNull();
    expect(
      formatJsonText(text, { ...config, minSavingsBytes: 100000 }),
    ).toBeNull();
    expect(
      formatJsonText(text, { ...config, minSavingsRatio: 0.99 }),
    ).toBeNull();
  });

  it("bypasses deeply nested data before invoking recursive codecs", () => {
    expect(
      formatJsonText("[".repeat(1000) + "0" + "]".repeat(1000), config),
    ).toBeNull();
  });
});
