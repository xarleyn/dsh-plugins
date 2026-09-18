/**
 * The prompt-sections half: reading a preset's sections, rewriting them in the
 * composition, and the registrar module a preset ships beside it.
 *
 * The preset root is a real temporary directory, so the guarantees under test
 * are the file system's own: the module exists before the composition names it,
 * a hand-edited module is never overwritten, and a refused write leaves both
 * files exactly as they were.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readDocument } from "../src/host/preset-reader.js";
import { savePersona as writePreset } from "../src/host/preset-writer.js";
import { DEFAULT_LIMITS } from "../src/host/validation.js";
import {
  SECTIONS_MODULE_FILE,
  SECTIONS_MODULE_SOURCE,
} from "../src/shared/prompt-sections.js";
import { rosterOf, writePresetFile } from "./helpers/preset-roster.js";
import {
  context,
  PERSONA_DRAFT,
  root,
  SECTIONS,
  WITH_PERSONA,
} from "./prompt-sections.helpers.js";

describe("the registrar module", () => {
  it("is created before the composition names it, and read back as present", async () => {
    const path = await writePresetFile(root, "demo", WITH_PERSONA);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    await writePreset(
      context(roster),
      "demo",
      { persona: PERSONA_DRAFT, sections: SECTIONS },
      "",
    );
    expect(
      await readFile(join(root, "demo", SECTIONS_MODULE_FILE), "utf8"),
    ).toBe(SECTIONS_MODULE_SOURCE);
    const document = await readDocument(roster, undefined, "demo");
    expect(document.sections).toEqual(SECTIONS);
    expect(document.sectionsModule).toBe("present");
    expect(document.sectionsState).toBe("local");
  });

  it("never overwrites a module someone wrote themselves", async () => {
    const path = await writePresetFile(root, "demo", WITH_PERSONA);
    const modulePath = join(root, "demo", SECTIONS_MODULE_FILE);
    await writeFile(
      modulePath,
      "// our own registrar\nexport function apply() {}\n",
      "utf8",
    );
    const roster = rosterOf({ demo: { path, trust: "user" } });
    await writePreset(
      context(roster),
      "demo",
      { persona: PERSONA_DRAFT, sections: SECTIONS },
      "",
    );
    expect(await readFile(modulePath, "utf8")).toContain("our own registrar");
    const document = await readDocument(roster, undefined, "demo");
    expect(document.sectionsModule).toBe("foreign");
  });

  it("removes its own module when the last section goes, and keeps a foreign one", async () => {
    const path = await writePresetFile(root, "demo", WITH_PERSONA);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const modulePath = join(root, "demo", SECTIONS_MODULE_FILE);
    await writePreset(
      context(roster),
      "demo",
      { persona: PERSONA_DRAFT, sections: SECTIONS },
      "",
    );
    const receipt = await writePreset(
      context(roster),
      "demo",
      { persona: PERSONA_DRAFT, sections: [] },
      (await readDocument(roster, undefined, "demo")).revision,
    );
    expect(receipt.revision).toMatch(/^[0-9a-f]{64}$/u);
    await expect(readFile(modulePath, "utf8")).rejects.toThrow();
    const document = await readDocument(roster, undefined, "demo");
    expect(document.sectionsState).toBe("none");
    expect(document.sectionsModule).toBe("missing");

    // A module the preset shipped itself is not the editor's to delete.
    await writeFile(modulePath, "// mine\n", "utf8");
    const kept = await writePreset(
      context(roster),
      "demo",
      { persona: PERSONA_DRAFT, sections: SECTIONS },
      document.revision,
    );
    await writePreset(
      context(roster),
      "demo",
      { persona: PERSONA_DRAFT, sections: [] },
      kept.revision,
    );
    expect(await readFile(modulePath, "utf8")).toBe("// mine\n");
  });

  it("writes persona and sections in one revision, and reads both back", async () => {
    const path = await writePresetFile(root, "demo", WITH_PERSONA);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const before = await readDocument(roster, undefined, "demo");
    const receipt = await writePreset(
      context(roster),
      "demo",
      { persona: PERSONA_DRAFT, sections: SECTIONS },
      before.revision,
    );
    const after = await readDocument(roster, undefined, "demo");
    expect(after.revision).toBe(receipt.revision);
    expect(after.persona).toEqual(PERSONA_DRAFT);
    expect(after.sections).toEqual(SECTIONS);
    const text = await readFile(path, "utf8");
    expect(text).toContain("# A probe preset.");
    expect(text).toContain("  disabled: !!js process.platform === 'win32'");
  });

  it("leaves both files alone when the deployment refuses the sections", async () => {
    const path = await writePresetFile(root, "demo", WITH_PERSONA);
    const roster = rosterOf({ demo: { path, trust: "user" } });
    const bytes = await readFile(path);
    await expect(
      writePreset(
        context(roster, { ...DEFAULT_LIMITS, maxSections: 1 }),
        "demo",
        { persona: PERSONA_DRAFT, sections: SECTIONS },
        "",
      ),
    ).rejects.toMatchObject({ code: "preset-persona/invalid" });
    expect((await readFile(path)).equals(bytes)).toBe(true);
    await expect(
      readFile(join(root, "demo", SECTIONS_MODULE_FILE), "utf8"),
    ).rejects.toThrow();
  });
});
