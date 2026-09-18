/**
 * The prompt-sections half: reading a preset's sections, rewriting them in the
 * composition, and the registrar module a preset ships beside it.
 *
 * The preset root is a real temporary directory, so the guarantees under test
 * are the file system's own: the module exists before the composition names it,
 * a hand-edited module is never overwritten, and a refused write leaves both
 * files exactly as they were.
 */

import { describe, expect, it } from "vitest";

import {
  applyPromptSections,
  parseComposition,
  readPromptSections,
  sectionsRows,
} from "../src/host/composition.js";
import {
  SECTIONS,
  WITH_PERSONA,
  WITH_SECTIONS,
} from "./prompt-sections.helpers.js";

describe("reading prompt sections", () => {
  it("answers none when the composition has no sections row", () => {
    const parse = parseComposition(WITH_PERSONA);
    expect(sectionsRows(parse)).toHaveLength(0);
    expect(readPromptSections(sectionsRows(parse))).toEqual({
      sections: [],
      unknownKeys: [],
      error: "",
    });
  });

  it("reads the sections in file order, with their enabled flags", () => {
    const values = readPromptSections(
      sectionsRows(parseComposition(WITH_SECTIONS)),
    );
    expect(values.sections).toEqual([
      {
        name: "team:style",
        order: 2500,
        text: "Answer in the user's language.",
        enabled: true,
      },
      {
        name: "harness:local-notes",
        order: 9000,
        text: "End with a summary.",
        enabled: false,
      },
    ]);
    expect(values.error).toBe("");
  });

  it("defaults `enabled` to true when the entry omits it", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    sections:",
      "      - name: team:style",
      "        order: 10",
      "        text: Keep it short.",
      "",
    ].join("\n");
    expect(
      readPromptSections(sectionsRows(parseComposition(text))).sections,
    ).toEqual([
      { name: "team:style", order: 10, text: "Keep it short.", enabled: true },
    ]);
  });

  it("reports an entry it will not rewrite instead of guessing", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    sections:",
      "      - name: team:style",
      "        order: !!js orderFor('team')",
      "        text: Keep it short.",
      "",
    ].join("\n");
    const values = readPromptSections(sectionsRows(parseComposition(text)));
    expect(values.error).toContain("not a plain name/order/text entry");
    expect(() =>
      applyPromptSections(text, SECTIONS, parseComposition(text)),
    ).toThrow(/not a plain/u);
  });

  it("reports a flow list, and refuses to rewrite it", () => {
    const flow = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    sections: [{ name: team:style, order: 1, text: keep it short }]",
      "",
    ].join("\n");
    const values = readPromptSections(sectionsRows(parseComposition(flow)));
    expect(values.error).toContain("flow sequence");
    expect(() =>
      applyPromptSections(flow, SECTIONS, parseComposition(flow)),
    ).toThrow(/flow sequence/u);
  });

  it("treats a sections key with no list as an empty list", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    sections:",
      "",
    ].join("\n");
    expect(
      readPromptSections(sectionsRows(parseComposition(text))).sections,
    ).toEqual([]);
  });

  it("reports the row's other config keys", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    sections:",
      "      - name: team:style",
      "        order: 10",
      "        text: Keep it short.",
      "    keepMe: 1",
      "",
    ].join("\n");
    expect(
      readPromptSections(sectionsRows(parseComposition(text))).unknownKeys,
    ).toEqual(["keepMe"]);
  });
});
