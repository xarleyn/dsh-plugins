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
  removePersonaRow,
} from "../src/host/composition.js";
import type { PersonaDraft } from "../src/types.js";
import {
  DEFAULTS,
  WITHOUT_PERSONA,
  WITH_PERSONA,
} from "./composition.helpers.js";

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
