import { renderScalar } from "./render.js";
import type { PromptSectionDraft } from "../types.js";

/**
 * The prompt-sections side of a preset: the row that mounts the registrar and
 * the shape of one section.
 *
 * Why a preset-local module instead of a plugin row: a preset that contributes
 * prompt text has to keep doing so when this editor is uninstalled. A row
 * naming an npm package would not — the preset would break the moment the
 * package left the deployment. A `./relative.mjs` row is the harness's own
 * mechanism for code a preset ships (the shipped presets and hand-authored
 * user presets both use it), it resolves from the preset's own directory, and
 * the module imports nothing from this plugin. The registrar is data-driven:
 * the sections themselves live in the row's `config.sections`, so the file is
 * written once and never has to be read back — which is why reading a preset's
 * sections is a matter of the row, not of the preset's directory.
 *
 * Node-free on purpose: the browser half imports these constants too.
 * @module shared/prompt-sections
 */

/** Row id the generated sections row carries. */
export const SECTIONS_ROW_ID = "prompt-sections";

/** Module specifier the generated sections row names, relative to the preset. */
export const SECTIONS_MODULE_SPECIFIER = "./prompt-sections.mjs";

/** Config key the row's section list lives under. */
export const SECTIONS_CONFIG_KEY = "sections";

/** Section-name prefixes that belong to first-party plugins. */
export const FIRST_PARTY_NAME_HINT =
  /^(?:deployment|harness|tool|plan|web|file|skills?):/u;

/** Default limits for the sections side of one write. */
export const DEFAULT_MAX_SECTIONS = 32;
export const DEFAULT_MAX_SECTIONS_BYTES = 262144;
export const MAX_SECTION_NAME_LENGTH = 200;
export const MAX_SECTION_ORDER = 1_000_000;

/**
 * Render the entries of a sections list at one indentation.
 *
 * One renderer serves both halves — the composition library splices this text
 * into a row and the browser preview shows it — so what the preview claims is
 * the list the row carries.
 * @param sections - the sections to render, in file order.
 * @param indent - column the `-` indicators start at.
 * @param eol - line ending to use.
 * @returns block-sequence text with no trailing line ending.
 */
export function renderSectionsList(
  sections: readonly PromptSectionDraft[],
  indent: number,
  eol: string,
): string {
  const pad = " ".repeat(indent);
  const keyPad = " ".repeat(indent + 2);
  return sections
    .map((section) =>
      [
        `${pad}- name: ${renderScalar(section.name, indent + 2, eol)}`,
        `${keyPad}order: ${String(section.order)}`,
        `${keyPad}text: ${renderScalar(section.text, indent + 2, eol)}`,
        `${keyPad}enabled: ${section.enabled ? "true" : "false"}`,
      ].join(eol),
    )
    .join(eol);
}
