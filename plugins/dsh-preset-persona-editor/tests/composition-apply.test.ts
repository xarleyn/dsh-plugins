/**
 * Composition surgery: reading a persona row, rewriting its four values, and
 * removing it — with every other byte of the file left alone.
 *
 * The fixtures are synthetic compositions shaped like the shipped ones: block
 * scalars, comments, `!!js` expression scalars, `{{cwd}}` templates, and a
 * persona row in each of the states a real roster contains.
 */

import { describe, expect, it } from "vitest";

import {
  applyPersonaDraft,
  parseComposition,
  personaRows,
  readPersonaValues,
} from "../src/host/composition.js";
import type { PersonaDraft } from "../src/types.js";
import {
  personaRowLines,
  WITHOUT_PERSONA,
  WITH_PERSONA,
} from "./composition.helpers.js";

describe("applyPersonaDraft", () => {
  const draft: PersonaDraft = {
    prefix: "You are a careful reviewer.\nPrefer small, reviewable changes.",
    suffix: "Answer in the user's language.",
    complete: false,
    includeRuntimeContext: false,
  };

  it("rewrites the managed values and leaves every other byte alone", () => {
    const parse = parseComposition(WITH_PERSONA);
    const next = applyPersonaDraft(WITH_PERSONA, draft, parse);
    const read = readPersonaValues(personaRows(parseComposition(next)));
    expect(read.draft).toEqual(draft);
    // The comments, the expression rows, and their disabled expressions are
    // still byte-identical: only the persona row moved.
    const { first, last } = personaRowLines(WITH_PERSONA);
    const before = WITH_PERSONA.split("\n");
    const after = next.split("\n");
    expect(after.slice(0, first)).toEqual(before.slice(0, first));
    expect(after.slice(after.length - (before.length - last - 1))).toEqual(
      before.slice(last + 1),
    );
    expect(next).toContain("  disabled: !!js process.platform === 'win32'");
    expect(next).toContain("# Comments here explain the deployment");
  });

  it("is idempotent: a second write of the same values changes nothing", () => {
    const first = applyPersonaDraft(
      WITH_PERSONA,
      draft,
      parseComposition(WITH_PERSONA),
    );
    const second = applyPersonaDraft(first, draft, parseComposition(first));
    expect(second).toBe(first);
  });

  it("writes a block literal for a multi-line prefix", () => {
    const next = applyPersonaDraft(
      WITH_PERSONA,
      draft,
      parseComposition(WITH_PERSONA),
    );
    expect(next).toContain("    prefix: |-");
    expect(next).toContain("      You are a careful reviewer.");
  });

  it("keeps the trailing newline a block scalar would otherwise swallow", () => {
    const value = { ...draft, prefix: "Line one.\nLine two.\n" };
    const next = applyPersonaDraft(
      WITH_PERSONA,
      value,
      parseComposition(WITH_PERSONA),
    );
    expect(next).toContain("    prefix: |\n");
    expect(
      readPersonaValues(personaRows(parseComposition(next))).draft.prefix,
    ).toBe(value.prefix);
  });

  it("quotes values a plain scalar would resolve differently", () => {
    for (const prefix of [
      "true",
      "42",
      "  padded  ",
      "# comment",
      "- dash",
      "",
    ]) {
      const value = { ...draft, prefix };
      const next = applyPersonaDraft(
        WITH_PERSONA,
        value,
        parseComposition(WITH_PERSONA),
      );
      expect(
        readPersonaValues(personaRows(parseComposition(next))).draft,
      ).toEqual(value);
    }
  });

  it("appends keys the row never had", () => {
    const text = [
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config:",
      "    prefix: only a prefix",
      "",
      "- id: tool-shell",
      "  name: '@deepseek-ai/dsh-tool-bash'",
      "",
    ].join("\n");
    const next = applyPersonaDraft(text, draft, parseComposition(text));
    expect(
      readPersonaValues(personaRows(parseComposition(next))).draft,
    ).toEqual(draft);
    expect(next).toContain("    complete: false");
    expect(next).toContain("    includeRuntimeContext: false");
    // The next row still starts its own item.
    expect(next).toContain("\n- id: tool-shell\n");
  });

  it("keeps appended keys adjacent to a block scalar they follow", () => {
    const text = [
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config:",
      "    prefix: |-",
      "      Line one.",
      "      Line two.",
      "",
      "- id: tool-shell",
      "  name: '@deepseek-ai/dsh-tool-bash'",
      "",
    ].join("\n");
    // The draft keeps the prefix the file already carries, so what this test
    // isolates is where the three missing keys land: inside the config mapping,
    // right after the block scalar, and not past the blank line that separates
    // the rows.
    const same = { ...draft, prefix: "Line one.\nLine two." };
    const next = applyPersonaDraft(text, same, parseComposition(text));
    const lines = next.split("\n");
    const last = lines.indexOf("      Line two.");
    // The block scalar's own lines, then the three appended keys with no blank
    // line in between, then the blank line that still separates the two rows.
    expect(lines.slice(last, last + 6)).toEqual([
      "      Line two.",
      `    suffix: ${same.suffix}`,
      "    complete: false",
      "    includeRuntimeContext: false",
      "",
      "- id: tool-shell",
    ]);
    expect(
      readPersonaValues(personaRows(parseComposition(next))).draft,
    ).toEqual(same);
  });

  it("hangs a config mapping off a row that has none", () => {
    const text = [
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "",
      "- id: tool-shell",
      "  name: '@deepseek-ai/dsh-tool-bash'",
      "",
    ].join("\n");
    const next = applyPersonaDraft(text, draft, parseComposition(text));
    expect(
      readPersonaValues(personaRows(parseComposition(next))).draft,
    ).toEqual(draft);
    expect(next).toContain("  config:\n    prefix: |-");
    expect(next).toContain("\n- id: tool-shell\n");
  });

  it("appends a whole row to a composition that has none", () => {
    const next = applyPersonaDraft(
      WITHOUT_PERSONA,
      draft,
      parseComposition(WITHOUT_PERSONA),
    );
    const parse = parseComposition(next);
    expect(personaRows(parse)).toHaveLength(1);
    expect(readPersonaValues(personaRows(parse)).draft).toEqual(draft);
    expect(next).toContain(
      "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n",
    );
    // The composition's own rows are untouched.
    expect(next).toContain("# A composition that never names a persona.");
  });

  it("appends a row to an empty composition", () => {
    const next = applyPersonaDraft("", draft, parseComposition(""));
    expect(
      readPersonaValues(personaRows(parseComposition(next))).draft,
    ).toEqual(draft);
  });

  it("follows the file's own line endings", () => {
    const crlf = WITH_PERSONA.replace(/\n/gu, "\r\n");
    const next = applyPersonaDraft(crlf, draft, parseComposition(crlf));
    expect(next).toContain(
      "    prefix: |-\r\n      You are a careful reviewer.\r\n",
    );
    expect(next.replace(/\r\n/gu, "")).not.toContain("\r");
    expect(
      readPersonaValues(personaRows(parseComposition(next))).draft,
    ).toEqual(draft);
  });

  it("handles a row whose keys sit deeper than the shipped indent", () => {
    const text = [
      "-   id: persona",
      "    name: '@deepseek-ai/dsh-persona'",
      "    config:",
      "      prefix: deep",
      "",
    ].join("\n");
    const next = applyPersonaDraft(text, draft, parseComposition(text));
    expect(next).toContain("      complete: false");
    expect(
      readPersonaValues(personaRows(parseComposition(next))).draft,
    ).toEqual(draft);
  });

  it("closes a file that ends without a line terminator", () => {
    const text = [
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config:",
      "    prefix: tail",
    ].join("\n");
    const next = applyPersonaDraft(text, draft, parseComposition(text));
    expect(next).not.toContain("tail    complete");
    expect(
      readPersonaValues(personaRows(parseComposition(next))).draft,
    ).toEqual(draft);
  });

  it("preserves a byte-order mark from the caller's text", () => {
    const marked = `\uFEFF${WITH_PERSONA}`;
    // The mark is split off before parsing; the rewrite never sees it.
    const next = applyPersonaDraft(
      marked,
      draft,
      parseComposition(marked.slice(1)),
    );
    expect(next.startsWith("\uFEFF")).toBe(true);
  });
});
