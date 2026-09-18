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

describe("writing prompt sections", () => {
  it("replaces the list in place and leaves every other byte alone", () => {
    const next = applyPromptSections(
      WITH_SECTIONS,
      SECTIONS,
      parseComposition(WITH_SECTIONS),
    );
    expect(
      readPromptSections(sectionsRows(parseComposition(next))).sections,
    ).toEqual(SECTIONS);
    expect(next).toContain(
      "- id: tool-shell\n  name: '@deepseek-ai/dsh-tool-bash'\n",
    );
    expect(next).toContain("        enabled: false\n");
  });

  it("appends a whole row to a composition that has none", () => {
    const next = applyPromptSections(
      WITH_PERSONA,
      SECTIONS,
      parseComposition(WITH_PERSONA),
    );
    expect(next).toContain(
      "- id: prompt-sections\n  name: ./prompt-sections.mjs\n",
    );
    expect(
      readPromptSections(sectionsRows(parseComposition(next))).sections,
    ).toEqual(SECTIONS);
    // The persona row and the expression row are untouched.
    expect(next).toContain("    prefix: You are a probe persona.");
    expect(next).toContain("  disabled: !!js process.platform === 'win32'");
  });

  it("adds the sections key to a row that has a config but no list", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    keepMe: 1",
      "",
    ].join("\n");
    const next = applyPromptSections(text, SECTIONS, parseComposition(text));
    const values = readPromptSections(sectionsRows(parseComposition(next)));
    expect(values.sections).toEqual(SECTIONS);
    expect(values.unknownKeys).toEqual(["keepMe"]);
  });

  it("hangs a config and a list off a row that has neither", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "",
      "- id: tool-shell",
      "  name: '@deepseek-ai/dsh-tool-bash'",
      "",
    ].join("\n");
    const next = applyPromptSections(text, SECTIONS, parseComposition(text));
    expect(
      readPromptSections(sectionsRows(parseComposition(next))).sections,
    ).toEqual(SECTIONS);
    expect(next).toContain(
      "  config:\n    sections:\n      - name: team:style\n",
    );
    expect(next).toContain("\n- id: tool-shell\n");
  });

  it("removes the row when the list is emptied", () => {
    const next = applyPromptSections(
      WITH_SECTIONS,
      [],
      parseComposition(WITH_SECTIONS),
    );
    expect(next).not.toContain("prompt-sections");
    expect(next).toContain("- id: tool-shell");
  });

  it("is a no-op when there is no row to remove", () => {
    expect(
      applyPromptSections(WITH_PERSONA, [], parseComposition(WITH_PERSONA)),
    ).toBe(WITH_PERSONA);
  });

  it("refuses two sections rows, and one nested in a group", () => {
    const twice = `${WITH_SECTIONS}\n${WITH_SECTIONS}`;
    expect(() =>
      applyPromptSections(twice, SECTIONS, parseComposition(twice)),
    ).toThrow(/more than one/u);
    const nested = [
      "- id: grouped",
      "  name: cordis:group",
      "  group: true",
      "  config:",
      "    - id: prompt-sections",
      "      name: ./prompt-sections.mjs",
      "      config:",
      "        sections: []",
      "",
    ].join("\n");
    expect(() =>
      applyPromptSections(nested, SECTIONS, parseComposition(nested)),
    ).toThrow(/nested inside a group/u);
  });
});
