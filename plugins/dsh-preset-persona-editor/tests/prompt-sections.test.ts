/**
 * The prompt-sections half: reading a preset's sections, rewriting them in the
 * composition, and the registrar module a preset ships beside it.
 *
 * The preset root is a real temporary directory, so the guarantees under test
 * are the file system's own: the module exists before the composition names it,
 * a hand-edited module is never overwritten, and a refused write leaves both
 * files exactly as they were.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyPromptSections,
  parseComposition,
  readPromptSections,
  sectionsRows,
} from "../src/host/composition.js";
import { readDocument } from "../src/host/preset-reader.js";
import {
  savePersona as writePreset,
  type WriteContext,
} from "../src/host/preset-writer.js";
import { DEFAULT_LIMITS, type PersonaLimits } from "../src/host/validation.js";
import {
  SECTIONS_MODULE_FILE,
  SECTIONS_MODULE_SOURCE,
} from "../src/shared/prompt-sections.js";
import type { PersonaDraft, PromptSectionDraft } from "../src/types.js";
import { rosterOf, writePresetFile } from "./helpers/preset-roster.js";

const PERSONA_DRAFT: PersonaDraft = {
  prefix: "You are a preset.",
  suffix: "",
  complete: false,
  includeRuntimeContext: true,
};

/** Two sections, one of them off. */
const SECTIONS: readonly PromptSectionDraft[] = [
  {
    name: "team:style",
    order: 2500,
    text: "Answer in the user's language.\nPrefer small, reviewable changes.",
    enabled: true,
  },
  {
    name: "harness:local-notes",
    order: 9000,
    text: "End with a summary.",
    enabled: false,
  },
];

const WITH_PERSONA = [
  "# A probe preset.",
  "",
  "- id: persona",
  "  name: '@deepseek-ai/dsh-persona'",
  "  config:",
  "    prefix: You are a probe persona.",
  "",
  "- id: tool-shell",
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "  disabled: !!js process.platform === 'win32'",
  "",
].join("\n");

const WITH_SECTIONS = [
  "- id: prompt-sections",
  "  name: ./prompt-sections.mjs",
  "  config:",
  "    sections:",
  "      - name: team:style",
  "        order: 2500",
  "        text: |-",
  "          Answer in the user's language.",
  "        enabled: true",
  "      - name: harness:local-notes",
  "        order: 9000",
  "        text: End with a summary.",
  "        enabled: false",
  "",
  "- id: tool-shell",
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "",
].join("\n");

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "preset-sections-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function context(
  roster: ReturnType<typeof rosterOf>,
  limits: PersonaLimits = DEFAULT_LIMITS,
): WriteContext {
  return { roster, limits };
}

describe("reading prompt sections", () => {
  it("answers none when the composition has no sections row", () => {
    const parse = parseComposition(WITH_PERSONA);
    expect(sectionsRows(parse)).toHaveLength(0);
    expect(readPromptSections(sectionsRows(parse))).toEqual({
      sections: [],
      unknownKeys: [],
      error: "",
    });
  });

  it("reads the sections in file order, with their enabled flags", () => {
    const values = readPromptSections(
      sectionsRows(parseComposition(WITH_SECTIONS)),
    );
    expect(values.sections).toEqual([
      {
        name: "team:style",
        order: 2500,
        text: "Answer in the user's language.",
        enabled: true,
      },
      {
        name: "harness:local-notes",
        order: 9000,
        text: "End with a summary.",
        enabled: false,
      },
    ]);
    expect(values.error).toBe("");
  });

  it("defaults `enabled` to true when the entry omits it", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    sections:",
      "      - name: team:style",
      "        order: 10",
      "        text: Keep it short.",
      "",
    ].join("\n");
    expect(
      readPromptSections(sectionsRows(parseComposition(text))).sections,
    ).toEqual([
      { name: "team:style", order: 10, text: "Keep it short.", enabled: true },
    ]);
  });

  it("reports an entry it will not rewrite instead of guessing", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    sections:",
      "      - name: team:style",
      "        order: !!js orderFor('team')",
      "        text: Keep it short.",
      "",
    ].join("\n");
    const values = readPromptSections(sectionsRows(parseComposition(text)));
    expect(values.error).toContain("not a plain name/order/text entry");
    expect(() =>
      applyPromptSections(text, SECTIONS, parseComposition(text)),
    ).toThrow(/not a plain/u);
  });

  it("reports a flow list, and refuses to rewrite it", () => {
    const flow = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    sections: [{ name: team:style, order: 1, text: keep it short }]",
      "",
    ].join("\n");
    const values = readPromptSections(sectionsRows(parseComposition(flow)));
    expect(values.error).toContain("flow sequence");
    expect(() =>
      applyPromptSections(flow, SECTIONS, parseComposition(flow)),
    ).toThrow(/flow sequence/u);
  });

  it("treats a sections key with no list as an empty list", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    sections:",
      "",
    ].join("\n");
    expect(
      readPromptSections(sectionsRows(parseComposition(text))).sections,
    ).toEqual([]);
  });

  it("reports the row's other config keys", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    sections:",
      "      - name: team:style",
      "        order: 10",
      "        text: Keep it short.",
      "    keepMe: 1",
      "",
    ].join("\n");
    expect(
      readPromptSections(sectionsRows(parseComposition(text))).unknownKeys,
    ).toEqual(["keepMe"]);
  });
});

describe("writing prompt sections", () => {
  it("replaces the list in place and leaves every other byte alone", () => {
    const next = applyPromptSections(
      WITH_SECTIONS,
      SECTIONS,
      parseComposition(WITH_SECTIONS),
    );
    expect(
      readPromptSections(sectionsRows(parseComposition(next))).sections,
    ).toEqual(SECTIONS);
    expect(next).toContain(
      "- id: tool-shell\n  name: '@deepseek-ai/dsh-tool-bash'\n",
    );
    expect(next).toContain("        enabled: false\n");
  });

  it("appends a whole row to a composition that has none", () => {
    const next = applyPromptSections(
      WITH_PERSONA,
      SECTIONS,
      parseComposition(WITH_PERSONA),
    );
    expect(next).toContain(
      "- id: prompt-sections\n  name: ./prompt-sections.mjs\n",
    );
    expect(
      readPromptSections(sectionsRows(parseComposition(next))).sections,
    ).toEqual(SECTIONS);
    // The persona row and the expression row are untouched.
    expect(next).toContain("    prefix: You are a probe persona.");
    expect(next).toContain("  disabled: !!js process.platform === 'win32'");
  });

  it("adds the sections key to a row that has a config but no list", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "  config:",
      "    keepMe: 1",
      "",
    ].join("\n");
    const next = applyPromptSections(text, SECTIONS, parseComposition(text));
    const values = readPromptSections(sectionsRows(parseComposition(next)));
    expect(values.sections).toEqual(SECTIONS);
    expect(values.unknownKeys).toEqual(["keepMe"]);
  });

  it("hangs a config and a list off a row that has neither", () => {
    const text = [
      "- id: prompt-sections",
      "  name: ./prompt-sections.mjs",
      "",
      "- id: tool-shell",
      "  name: '@deepseek-ai/dsh-tool-bash'",
      "",
    ].join("\n");
    const next = applyPromptSections(text, SECTIONS, parseComposition(text));
    expect(
      readPromptSections(sectionsRows(parseComposition(next))).sections,
    ).toEqual(SECTIONS);
    expect(next).toContain(
      "  config:\n    sections:\n      - name: team:style\n",
    );
    expect(next).toContain("\n- id: tool-shell\n");
  });

  it("removes the row when the list is emptied", () => {
    const next = applyPromptSections(
      WITH_SECTIONS,
      [],
      parseComposition(WITH_SECTIONS),
    );
    expect(next).not.toContain("prompt-sections");
    expect(next).toContain("- id: tool-shell");
  });

  it("is a no-op when there is no row to remove", () => {
    expect(
      applyPromptSections(WITH_PERSONA, [], parseComposition(WITH_PERSONA)),
    ).toBe(WITH_PERSONA);
  });

  it("refuses two sections rows, and one nested in a group", () => {
    const twice = `${WITH_SECTIONS}\n${WITH_SECTIONS}`;
    expect(() =>
      applyPromptSections(twice, SECTIONS, parseComposition(twice)),
    ).toThrow(/more than one/u);
    const nested = [
      "- id: grouped",
      "  name: cordis:group",
      "  group: true",
      "  config:",
      "    - id: prompt-sections",
      "      name: ./prompt-sections.mjs",
      "      config:",
      "        sections: []",
      "",
    ].join("\n");
    expect(() =>
      applyPromptSections(nested, SECTIONS, parseComposition(nested)),
    ).toThrow(/nested inside a group/u);
  });
});

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
