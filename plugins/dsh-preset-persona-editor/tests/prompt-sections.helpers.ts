/**
 * Shared fixtures for the prompt-sections tests, moved here verbatim from the
 * single-file original.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

import type { WriteContext } from "../src/host/preset-writer.js";
import { DEFAULT_LIMITS, type PersonaLimits } from "../src/host/validation.js";
import type { PersonaDraft, PromptSectionDraft } from "../src/types.js";
import { rosterOf } from "./helpers/preset-roster.js";

export const PERSONA_DRAFT: PersonaDraft = {
  prefix: "You are a preset.",
  suffix: "",
  complete: false,
  includeRuntimeContext: true,
};

/** Two sections, one of them off. */
export const SECTIONS: readonly PromptSectionDraft[] = [
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

export const WITH_PERSONA = [
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

export const WITH_SECTIONS = [
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

export let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "preset-sections-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

export function context(
  roster: ReturnType<typeof rosterOf>,
  limits: PersonaLimits = DEFAULT_LIMITS,
): WriteContext {
  return { roster, limits };
}
