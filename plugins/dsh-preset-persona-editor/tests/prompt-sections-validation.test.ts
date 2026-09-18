/**
 * The prompt-sections half: reading a preset's sections, rewriting them in the
 * composition, and the registrar module a preset ships beside it.
 *
 * The preset root is a real temporary directory, so the guarantees under test
 * are the file system's own: the module exists before the composition names it,
 * a hand-edited module is never overwritten, and a refused write leaves both
 * files exactly as they were.
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { savePersona as writePreset } from "../src/host/preset-writer.js";
import type { PromptSectionDraft } from "../src/types.js";
import { rosterOf, writePresetFile } from "./helpers/preset-roster.js";
import {
  context,
  PERSONA_DRAFT,
  root,
  WITH_PERSONA,
} from "./prompt-sections.helpers.js";

describe("section validation", () => {
  const cases: readonly { name: string; sections: PromptSectionDraft[] }[] = [
    {
      name: "duplicate names",
      sections: [
        { name: "team:style", order: 1, text: "a", enabled: true },
        { name: "team:style", order: 2, text: "b", enabled: true },
      ],
    },
    {
      name: "a fractional order",
      sections: [{ name: "team:style", order: 1.5, text: "a", enabled: true }],
    },
    {
      name: "an empty text",
      sections: [{ name: "team:style", order: 1, text: "   ", enabled: true }],
    },
    {
      name: "a name with a newline",
      sections: [{ name: "team:\nstyle", order: 1, text: "a", enabled: true }],
    },
    {
      name: "an empty name",
      sections: [{ name: "", order: 1, text: "a", enabled: true }],
    },
  ];

  for (const entry of cases) {
    it(`refuses ${entry.name} without touching the file`, async () => {
      const path = await writePresetFile(root, "demo", WITH_PERSONA);
      const roster = rosterOf({ demo: { path, trust: "user" } });
      const bytes = await readFile(path);
      await expect(
        writePreset(
          context(roster),
          "demo",
          { persona: PERSONA_DRAFT, sections: entry.sections },
          "",
        ),
      ).rejects.toMatchObject({ code: "preset-persona/invalid" });
      expect((await readFile(path)).equals(bytes)).toBe(true);
    });
  }
});
