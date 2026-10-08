/**
 * Reading presets: a preset's persona state out of the composition the registry
 * renders, and every failure the page has to say instead of a reading.
 *
 * The roster is a fixture over the same face the plugin reads the host with, so
 * what is under test is the reader's own decisions: what counts as one persona,
 * what an unmanaged key is, and what a refused or unparsable composition answers
 * with. The refusals are worded the way the published `0.1.7-rc.2` registry
 * words them, so a test that passes on the fixture cannot pass on an invented
 * reason.
 */

import { describe, expect, it, vi, type Mock } from "vitest";

import {
  readCatalog,
  readDocument,
  type PresetReadLogger,
} from "../src/host/preset-reader.js";
import {
  INHERITED_PRESET,
  OWNED_PRESET,
  rosterOf,
} from "./preset-roster.helpers.js";

/** A logger that records what the reader had to say about a refusal. */
function recordingLogger(): { warn: Mock<PresetReadLogger["warn"]> } {
  return { warn: vi.fn<PresetReadLogger["warn"]>() };
}

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
    expect(document.readError).toBe("");
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

  it("reads a broken preset's composition, and calls a refused one unreadable", async () => {
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

  it("keeps the roster's own order over a read that finishes out of order", async () => {
    const roster = rosterOf({
      slow: { content: INHERITED_PRESET },
      fast: { content: OWNED_PRESET },
    });
    const catalog = await readCatalog(roster);
    expect(catalog.presets.map((row) => row.id)).toEqual(["slow", "fast"]);
  });

  it("carries the registry's own reason when it refuses a composition", async () => {
    const roster = rosterOf({ retired: { content: null } });
    const document = await readDocument(roster, undefined, "retired");
    expect(document.persona.prefix).toBe("");
    expect(document.source).toBe("");
    expect(document.rowCount).toBe(0);
    expect(document.readError).toContain("Unknown agent preset: retired");
  });

  it("logs a refused composition beside the row that shows it", async () => {
    const logger = recordingLogger();
    const roster = rosterOf({ retired: { content: null } });
    const catalog = await readCatalog(roster, logger);
    expect(catalog.presets[0]?.persona).toBe("unreadable");
    expect(logger.warn).toHaveBeenCalledWith(
      "preset-persona.composition-refused",
      { agentPreset: "retired", reason: expect.any(String) },
    );
  });

  it("says a refusal that belongs to the host once for the roster it covers", async () => {
    const logger = recordingLogger();
    const roster = rosterOf(
      {
        one: { content: OWNED_PRESET },
        two: { content: INHERITED_PRESET },
        three: { content: OWNED_PRESET },
      },
      "one",
      { withoutReadDocument: true },
    );
    const catalog = await readCatalog(roster, logger);
    expect(catalog.presets).toHaveLength(3);
    // The registry either publishes `readDocument()` or it does not, so three
    // rows refused the same way are one fact about the deployment. Answered per
    // row, every visit to Settings cost this deployment three identical `warn`
    // lines for that one fact, and the roster grows with it.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "preset-persona.composition-refused",
      {
        agentPreset: "one, two, three",
        reason: expect.stringMatching(/does not answer readDocument/u),
      },
    );
  });

  it("keeps a refusal that belongs to one preset beside that preset", async () => {
    const logger = recordingLogger();
    const roster = rosterOf({
      healthy: { content: OWNED_PRESET },
      retired: { content: null },
      alsoHealthy: { content: INHERITED_PRESET },
    });
    await readCatalog(roster, logger);
    // Grouping by reason must not merge what the registry refused for its own
    // reasons: this is one preset's fact, and the id that names it is the whole
    // content of the line.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "preset-persona.composition-refused",
      {
        agentPreset: "retired",
        reason: expect.stringContaining("Unknown agent preset: retired"),
      },
    );
  });

  it("reads the composition of the preset the roster resolved", async () => {
    // `resolve(id?)` answers the deployment's default when the id is left out —
    // the installed class reads `id ?? this.defaultId` — while `readDocument()`
    // looks the id up exactly, with no such fallback. Asking with the request
    // rather than the answer would hand back the default preset's document under
    // `Unknown agent preset: undefined`. The Remote's parameter is typed, but the
    // face it drives keeps the host's optional one.
    const roster = rosterOf({ demo: { content: OWNED_PRESET } }, "demo");
    const document = await readDocument(
      roster,
      undefined,
      undefined as unknown as string,
    );
    expect(document.id).toBe("demo");
    expect(document.readError).toBe("");
    expect(document.persona.prefix).toBe("You are the shipped demo persona.");
  });

  it("says the registry has no readDocument, instead of blaming the presets", async () => {
    const logger = recordingLogger();
    const roster = rosterOf({ demo: { content: OWNED_PRESET } }, "demo", {
      withoutReadDocument: true,
    });
    const catalog = await readCatalog(roster, logger);
    expect(catalog.presets[0]?.persona).toBe("unreadable");
    const document = await readDocument(roster, undefined, "demo", logger);
    expect(document.readError).toMatch(/does not answer readDocument/u);
    expect(catalog.presets[0]?.broken).toBe("");
  });

  it("refuses an answer that is not a composition, in words", async () => {
    const logger = recordingLogger();
    const roster = rosterOf({ demo: { content: OWNED_PRESET } }, "demo", {
      answerNothing: true,
    });
    const catalog = await readCatalog(roster, logger);
    expect(catalog.presets[0]?.persona).toBe("unreadable");
    const document = await readDocument(roster, undefined, "demo", logger);
    // The reader tells a refusal from an answer by the answer's `composition`,
    // so an answer that carries no text has to be turned into a refusal here —
    // reading it further would raise a TypeError this page then shows as the
    // only reason it has.
    expect(document.readError).toMatch(/without a composition to read/u);
    expect(document.readError).not.toMatch(/Cannot read properties/u);
    expect(document.source).toBe("");
    expect(logger.warn).toHaveBeenCalledWith(
      "preset-persona.composition-refused",
      expect.objectContaining({ agentPreset: "demo" }),
    );
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
    expect(document.persona.prefix).toBe("");
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
