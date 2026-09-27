/**
 * Reading presets: a preset's persona state out of the composition the registry
 * renders, and every failure the page has to say instead of a reading.
 *
 * The roster is a fixture over the same face the plugin reads the host with, so
 * what is under test is the reader's own decisions: what counts as one persona,
 * what an unmanaged key is, and what a refused or unparsable composition answers
 * with.
 */

import { describe, expect, it } from "vitest";

import { readCatalog, readDocument } from "../src/host/preset-reader.js";
import {
  INHERITED_PRESET,
  OWNED_PRESET,
  rosterOf,
} from "./preset-roster.helpers.js";

describe("reading presets", () => {
  it("reports a local persona with its four values", async () => {
    const roster = rosterOf({ demo: { content: OWNED_PRESET } });
    const document = await readDocument(roster, undefined, "demo");
    expect(document.persona).toEqual({
      prefix: "You are the shipped demo persona.",
      suffix: "",
      complete: false,
      includeRuntimeContext: true,
    });
    expect(document.hasRow).toBe(true);
    expect(document.editable).toBe(true);
    expect(document.rowCount).toBe(2);
    expect(document.source).toBe(OWNED_PRESET);
  });

  it("reports the inherited state when the preset has no persona row", async () => {
    const roster = rosterOf({ demo: { content: INHERITED_PRESET } });
    const document = await readDocument(roster, undefined, "demo");
    expect(document.hasRow).toBe(false);
    expect(document.persona.prefix).toBe("");
    expect(document.persona.includeRuntimeContext).toBe(true);
  });

  it("marks a preset that cannot compose, and one with no composition, as unreadable material", async () => {
    const roster = rosterOf(
      {
        shipped: {
          content: OWNED_PRESET,
          broken: "the tool row names nothing",
        },
        retired: { content: null },
      },
      "shipped",
    );
    const catalog = await readCatalog(roster);
    const shipped = catalog.presets.find((row) => row.id === "shipped");
    expect(shipped?.broken).toBe("the tool row names nothing");
    expect(shipped?.persona).toBe("local");
    expect(shipped?.isDefault).toBe(true);
    const retired = catalog.presets.find((row) => row.id === "retired");
    expect(retired?.persona).toBe("unreadable");
    expect(retired?.broken).toBe("");
  });

  it("reports an ambiguous preset instead of guessing", async () => {
    const roster = rosterOf({
      demo: {
        content: [
          "- id: persona",
          "  name: '@deepseek-ai/dsh-persona'",
          "  config:",
          "    prefix: first",
          "",
          "- id: persona-two",
          "  name: '@deepseek-ai/dsh-persona'",
          "  config:",
          "    prefix: second",
          "",
        ].join("\n"),
      },
    });
    const document = await readDocument(roster, undefined, "demo");
    expect(document.hasRow).toBe(false);
    expect(document.extraRows).toBe(1);
  });

  it("reports the failure of a composition that is not a list", async () => {
    const roster = rosterOf({ demo: { content: "id: persona\n" } });
    const document = await readDocument(roster, undefined, "demo");
    expect(document.editable).toBe(false);
    expect(document.readError).toMatch(/not a YAML list/u);
  });

  it("uses the deployment's own section orders", async () => {
    const roster = rosterOf({ demo: { content: OWNED_PRESET } });
    const document = await readDocument(
      roster,
      {
        getSectionOrder: (name) =>
          name === "DEPLOYMENT_PERSONA_PREFIX" ? -1000 : 9900,
      },
      "demo",
    );
    expect(document.prefixOrder).toBe(-1000);
    expect(document.suffixOrder).toBe(9900);
  });

  it("answers the editor's not-found code for an unknown preset", async () => {
    const roster = rosterOf({});
    await expect(
      readDocument(roster, undefined, "ghost"),
    ).rejects.toMatchObject({
      code: "preset-persona/not-found",
    });
  });
});
