/**
 * The registrar module a preset ships beside its composition, as the reader
 * reports it.
 *
 * The preset root is a real temporary directory, because the only fact here is a
 * file: whether the registrar is there, whether it is this editor's own copy,
 * and what the page says when it cannot check either.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readDocument } from "../src/host/preset-reader.js";
import {
  SECTIONS_MODULE_FILE,
  SECTIONS_MODULE_SOURCE,
} from "../src/shared/prompt-sections.js";
import { rosterOf, writePresetFile } from "./helpers/preset-roster.js";
import { root, WITH_SECTIONS } from "./prompt-sections.helpers.js";

describe("the registrar module", () => {
  it("reads as present when the preset ships this editor's own copy", async () => {
    const path = await writePresetFile(root, "demo", WITH_SECTIONS);
    await writeFile(
      join(root, "demo", SECTIONS_MODULE_FILE),
      SECTIONS_MODULE_SOURCE,
      "utf8",
    );
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const document = await readDocument(roster, undefined, "demo");
    expect(document.sectionsModule).toBe("present");
    expect(document.sectionsState).toBe("local");
    expect(document.sections.map((section) => section.name)).toEqual([
      "team:style",
      "harness:local-notes",
    ]);
  });

  it("reads as foreign when the file was written by hand", async () => {
    const path = await writePresetFile(root, "demo", WITH_SECTIONS);
    const modulePath = join(root, "demo", SECTIONS_MODULE_FILE);
    await writeFile(
      modulePath,
      "// our own registrar\nexport function apply() {}\n",
      "utf8",
    );
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const document = await readDocument(roster, undefined, "demo");
    expect(document.sectionsModule).toBe("foreign");
    // A foreign registrar still carries the section list the composition names.
    expect(await readFile(modulePath, "utf8")).toContain("our own registrar");
    expect(document.sections).toHaveLength(2);
  });

  it("reads as missing when the composition names a module that is not there", async () => {
    const path = await writePresetFile(root, "demo", WITH_SECTIONS);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const document = await readDocument(roster, undefined, "demo");
    expect(document.sectionsModule).toBe("missing");
    expect(document.sectionsState).toBe("local");
  });

  it("still reports the registrar's own state when the composition cannot be read", async () => {
    const roster = rosterOf({
      demo: { path: join(root, "nowhere", "agent.cordis.yml"), trust: "user" },
    });
    const document = await readDocument(roster, undefined, "demo");
    // Nothing beside a file the reader cannot open was checked: the sections
    // half is unreadable, and the registrar is whatever the directory holds.
    expect(document.sectionsModule).toBe("missing");
    expect(document.sectionsState).toBe("unreadable");
    expect(document.readError).toContain("could not be read");
  });
});
