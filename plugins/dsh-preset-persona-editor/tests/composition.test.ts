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
  CompositionError,
  moduleRows,
  parseComposition,
  personaRows,
  readPersonaValues,
  removePersonaRow,
} from "../src/host/composition.js";
import { PERSONA_PLUGIN_NAME } from "../src/shared/persona.js";
import type { PersonaDraft } from "../src/types.js";

const DEFAULTS: PersonaDraft = {
  prefix: "",
  suffix: "",
  complete: false,
  includeRuntimeContext: true,
};

/** A composition with a persona row, comments, an expression, and other rows. */
const WITH_PERSONA = [
  "# The `demo` preset: a synthetic composition used by the tests.",
  "#",
  "# Comments here explain the deployment, and they must survive every edit.",
  "",
  "# ── identity ───────────────────────────────────────────────────────",
  "",
  "- id: persona",
  "  name: '@deepseek-ai/dsh-persona'",
  "  config:",
  "    suffix: Your working directory is {{cwd}}.",
  "    prefix: >-",
  "      You are a coding agent powered by the {{model}} model.",
  "",
  "- id: tool-shell",
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "  disabled: !!js process.platform === 'win32'",
  "",
  "- id: tool-pwsh",
  "  name: '@deepseek-ai/dsh-tool-pwsh'",
  "  disabled: !!js process.platform !== 'win32'",
  "",
].join("\n");

/** A composition with no persona row at all: the inherited state. */
const WITHOUT_PERSONA = [
  "# A composition that never names a persona.",
  "",
  "- id: tool-shell",
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "",
].join("\n");

/** The persona row as (start, end) line indices inside {@link WITH_PERSONA}. */
function personaRowLines(text: string): {
  readonly first: number;
  readonly last: number;
} {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.includes("id: persona"));
  let last = first;
  while (last + 1 < lines.length && !/^- /u.test(lines[last + 1] ?? ""))
    last += 1;
  return { first, last };
}

describe("parseComposition", () => {
  it("reads the persona row's four values", () => {
    const parse = parseComposition(WITH_PERSONA);
    const values = readPersonaValues(personaRows(parse));
    expect(values.draft).toEqual({
      prefix: "You are a coding agent powered by the {{model}} model.",
      suffix: "Your working directory is {{cwd}}.",
      complete: false,
      includeRuntimeContext: true,
    });
    expect(values.unknownKeys).toEqual([]);
    expect(values.foreignKeys).toEqual([]);
  });

  it("answers defaults when the composition names no persona", () => {
    const parse = parseComposition(WITHOUT_PERSONA);
    expect(personaRows(parse)).toHaveLength(0);
    expect(readPersonaValues(personaRows(parse)).draft).toEqual(DEFAULTS);
  });

  it("refuses a document that is not a list of rows", () => {
    expect(() => parseComposition("id: persona\n")).toThrow(CompositionError);
  });

  it("refuses text that is not valid YAML", () => {
    expect(() => parseComposition("- id: [unclosed\n")).toThrow(
      CompositionError,
    );
  });

  it("counts persona rows nested in groups as rows this editor does not own", () => {
    const text = [
      "- id: grouped",
      "  name: cordis:group",
      "  group: true",
      "  config:",
      "    - id: persona",
      "      name: '@deepseek-ai/dsh-persona'",
      "      config:",
      "        prefix: nested",
      "",
    ].join("\n");
    const parse = parseComposition(text);
    const rows = moduleRows(parse, PERSONA_PLUGIN_NAME);
    expect(rows.rows).toHaveLength(0);
    expect(rows.deep).toBe(1);
    expect(() => applyPersonaDraft(text, DEFAULTS, parse)).toThrow(
      /nested inside a group/u,
    );
  });

  it("reports unmanaged keys instead of rewriting them", () => {
    const text = [
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config:",
      "    text: a key from an older composition",
      "    prefix: kept",
      "",
    ].join("\n");
    const values = readPersonaValues(parseComposition(text).rows);
    expect(values.unknownKeys).toEqual(["text"]);
    expect(values.draft.prefix).toBe("kept");
  });

  it("reports an owned key whose value is an expression", () => {
    const text = [
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config:",
      "    prefix: kept",
      "    complete: !!js process.env.PERSONA_COMPLETE === '1'",
      "",
    ].join("\n");
    const values = readPersonaValues(parseComposition(text).rows);
    expect(values.foreignKeys).toEqual(["complete"]);
    expect(() =>
      applyPersonaDraft(
        text,
        { ...DEFAULTS, prefix: "x" },
        parseComposition(text),
      ),
    ).toThrow(/not a plain value/u);
  });

  it("refuses a persona row whose config is a flow mapping", () => {
    const text = [
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config: { prefix: hi }",
      "",
    ].join("\n");
    expect(() => parseComposition(text)).toThrow(/flow style/u);
  });

  it("refuses two persona rows rather than guessing", () => {
    const text = [
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config:",
      "    prefix: first",
      "",
      "- id: persona-2",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config:",
      "    prefix: second",
      "",
    ].join("\n");
    const parse = parseComposition(text);
    expect(personaRows(parse)).toHaveLength(2);
    expect(() => applyPersonaDraft(text, DEFAULTS, parse)).toThrow(
      /more than one/u,
    );
    expect(() => removePersonaRow(text, parse)).toThrow(/more than one/u);
  });
});

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

describe("removePersonaRow", () => {
  it("removes the row and the blank line it leaves behind", () => {
    const parse = parseComposition(WITH_PERSONA);
    const next = removePersonaRow(WITH_PERSONA, parse);
    expect(next).not.toContain("dsh-persona");
    expect(next).toContain("- id: tool-shell");
    expect(next).toContain("# Comments here explain the deployment");
    // The two blank lines around the removed row collapse into one.
    expect(next).not.toMatch(/\n{3,}/u);
    expect(
      readPersonaValues(personaRows(parseComposition(next))).draft,
    ).toEqual(DEFAULTS);
  });

  it("is a no-op when the composition has no persona row", () => {
    expect(
      removePersonaRow(WITHOUT_PERSONA, parseComposition(WITHOUT_PERSONA)),
    ).toBe(WITHOUT_PERSONA);
  });

  it("round-trips: remove then write restores an equivalent composition", () => {
    const without = removePersonaRow(
      WITH_PERSONA,
      parseComposition(WITH_PERSONA),
    );
    const draft: PersonaDraft = {
      prefix: "Restored persona.",
      suffix: "",
      complete: false,
      includeRuntimeContext: true,
    };
    const restored = applyPersonaDraft(
      without,
      draft,
      parseComposition(without),
    );
    expect(
      readPersonaValues(personaRows(parseComposition(restored))).draft,
    ).toEqual(draft);
  });

  it("removes a row that is the last item of the composition", () => {
    const text = [
      "- id: tool-shell",
      "  name: '@deepseek-ai/dsh-tool-bash'",
      "",
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config:",
      "    prefix: last",
      "",
    ].join("\n");
    const next = removePersonaRow(text, parseComposition(text));
    expect(next).toBe(
      "- id: tool-shell\n  name: '@deepseek-ai/dsh-tool-bash'\n",
    );
  });

  it("removes a row written in CRLF", () => {
    const crlf = [
      "- id: tool-shell",
      "  name: '@deepseek-ai/dsh-tool-bash'",
      "",
      "- id: persona",
      "  name: '@deepseek-ai/dsh-persona'",
      "  config:",
      "    prefix: last",
      "",
    ].join("\r\n");
    const next = removePersonaRow(crlf, parseComposition(crlf));
    expect(next).toBe(
      "- id: tool-shell\r\n  name: '@deepseek-ai/dsh-tool-bash'\r\n",
    );
  });
});
