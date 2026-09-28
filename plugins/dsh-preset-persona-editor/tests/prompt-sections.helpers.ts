/**
 * Shared fixtures for the prompt-sections tests: compositions the reader and
 * the surgery library are handed, in the spellings a preset actually uses.
 */

import type { PromptSectionDraft } from "../src/types.js";

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
