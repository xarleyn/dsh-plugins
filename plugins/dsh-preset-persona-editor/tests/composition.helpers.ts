/**
 * Shared fixtures for the composition surgery tests, moved here verbatim from
 * the single-file original.
 */

import type { PersonaDraft } from "../src/types.js";

export const DEFAULTS: PersonaDraft = {
  prefix: "",
  suffix: "",
  complete: false,
  includeRuntimeContext: true,
};

/** A composition with a persona row, comments, an expression, and other rows. */
export const WITH_PERSONA = [
  "# The `demo` preset: a synthetic composition used by the tests.",
  "#",
  "# Comments here explain the deployment, and they must survive every edit.",
  "",
  "# ── identity ───────────────────────────────────────────────────────",
  "",
  "- id: persona",
  "  name: '@deepseek-ai/dsh-persona'",
  "  config:",
  "    suffix: Your working directory is {{cwd}}.",
  "    prefix: >-",
  "      You are a coding agent powered by the {{model}} model.",
  "",
  "- id: tool-shell",
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "  disabled: !!js process.platform === 'win32'",
  "",
  "- id: tool-pwsh",
  "  name: '@deepseek-ai/dsh-tool-pwsh'",
  "  disabled: !!js process.platform !== 'win32'",
  "",
].join("\n");

/** A composition with no persona row at all: the inherited state. */
export const WITHOUT_PERSONA = [
  "# A composition that never names a persona.",
  "",
  "- id: tool-shell",
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "",
].join("\n");

/** The persona row as (start, end) line indices inside {@link WITH_PERSONA}. */
export function personaRowLines(text: string): {
  readonly first: number;
  readonly last: number;
} {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.includes("id: persona"));
  let last = first;
  while (last + 1 < lines.length && !/^- /u.test(lines[last + 1] ?? ""))
    last += 1;
  return { first, last };
}
