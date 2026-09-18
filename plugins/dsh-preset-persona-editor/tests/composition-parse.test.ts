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
import {
  DEFAULTS,
  WITHOUT_PERSONA,
  WITH_PERSONA,
} from "./composition.helpers.js";

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
