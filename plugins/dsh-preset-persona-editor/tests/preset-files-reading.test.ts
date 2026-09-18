/**
 * The file layer: reading a preset's persona state, the revision guard, and
 * every refusal that must leave the file exactly as it was.
 *
 * The preset root is a real temporary directory, so the guarantees under test
 * are the ones the file system gives: bytes on disk, modes, the byte-order
 * mark, and the fact that a refused write did not touch the file at all.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readCatalog, readDocument } from "../src/host/preset-reader.js";
import {
  INHERITED_PRESET,
  OWNED_PRESET,
  preset,
  root,
  rosterOf,
} from "./preset-files.helpers.js";

describe("reading presets", () => {
  it("reports a local persona with its four values", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
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
    expect(document.revision).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("reports the inherited state when the preset has no persona row", async () => {
    const path = await preset(INHERITED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const document = await readDocument(roster, undefined, "demo");
    expect(document.hasRow).toBe(false);
    expect(document.persona.prefix).toBe("");
    expect(document.persona.includeRuntimeContext).toBe(true);
  });

  it("marks a shipped preset as not editable, and unreadable files as such", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({
      shipped: { path, trust: "system" },
      missing: {
        path: join(root, "nowhere", "agent.cordis.yml"),
        trust: "user",
      },
    });
    const catalog = await readCatalog(roster);
    expect(catalog.authorable).toBe(true);
    const shipped = catalog.presets.find((row) => row.id === "shipped");
    expect(shipped?.editable).toBe(false);
    expect(shipped?.trust).toBe("system");
    const missing = catalog.presets.find((row) => row.id === "missing");
    expect(missing?.persona).toBe("unreadable");
    expect(missing?.editable).toBe(false);
    expect(missing?.revision).toBe("");
  });

  it("reports an ambiguous preset instead of guessing", async () => {
    const path = await preset(
      [
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
    );
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const document = await readDocument(roster, undefined, "demo");
    expect(document.hasRow).toBe(false);
    expect(document.extraRows).toBe(1);
  });

  it("reports the failure of a composition that is not a list", async () => {
    const path = await preset("id: persona\n");
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const document = await readDocument(roster, undefined, "demo");
    expect(document.editable).toBe(false);
    expect(document.readError).toMatch(/not a YAML list/u);
  });

  it("uses the deployment's own section orders", async () => {
    const path = await preset(OWNED_PRESET);
    const roster = rosterOf({ demo: { path, trust: "user" } });
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
