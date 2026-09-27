/**
 * `@yadsh/dsh-preset-persona-editor`: read what an agent preset contributes to
 * the prompt — prefix, suffix, complete mode, the runtime-context toggle, and
 * the named sections — from the settings UI.
 *
 * The Cordis entrypoint. The plugin registers `ctx.presetPersonaEditor` and
 * nothing else: no prompt section, no tool, no listener. The persona a session
 * actually receives is the one `@deepseek-ai/dsh-persona` composes from the
 * preset's own composition, and this plugin only ever reads it: the Host has no
 * durable preset-authoring path since `0.1.7-rc.2`, so editing from this page
 * went with it (decision D2 of `docs/DSH-0.1.7-MIGRATION.md` §10).
 */

import { PresetPersonaEditor } from "./host/service.js";

export { PresetPersonaEditor } from "./host/service.js";
export type { PresetPersonaEditorDeps } from "./host/service.js";
export {
  normalizeDraft,
  normalizeSections,
  DEFAULT_LIMITS,
  reasonOf,
  validateDraft,
  validateSections,
  type PersonaLimits,
} from "./host/validation.js";
export {
  applyPersonaDraft,
  applyPromptSections,
  CompositionError,
  moduleRows,
  parseComposition,
  personaRows,
  readPersonaValues,
  readPromptSections,
  removePersonaRow,
  sectionsRows,
  type CompositionParse,
  type CompositionRow,
  type ModuleRows,
  type PersonaRowValues,
  type RowConfigKey,
  type SectionsRowValues,
} from "./host/composition.js";
export {
  inspectComposition,
  inspectPreset,
  personaOrders,
  readCatalog,
  readComposition,
  readDocument,
  type CompositionInspection,
  type PresetComposition,
  type PresetEntry,
  type PresetRosterFace,
  type SystemPromptFace,
} from "./host/preset-reader.js";
export { invalid, notFound, unavailable } from "./host/errors.js";
export {
  PERSONA_MANAGED_KEYS,
  PERSONA_PLUGIN_NAME,
  PERSONA_PREFIX_FALLBACK_ORDER,
  PERSONA_PREFIX_ORDER_NAME,
  PERSONA_ROW_ID,
  PERSONA_SUFFIX_FALLBACK_ORDER,
  PERSONA_SUFFIX_ORDER_NAME,
  type PersonaManagedKey,
} from "./shared/persona.js";
export {
  detectEol,
  joinBom,
  renderConfigBlock,
  renderPersonaRow,
  renderScalar,
  splitBom,
  type BomSplit,
} from "./shared/render.js";
export type {
  PersonaCatalog,
  PersonaDocument,
  PersonaDraft,
  PersonaPresetRow,
  PersonaState,
} from "./types.js";

/** Cordis plugin name (the unscoped runtime id of the bundle patch). */
export const name = "preset-persona-editor";

/** Services this plugin reads; the roster is the one it cannot work without. */
export const inject: readonly string[] = ["agentPresets", "systemPrompt"];

export default PresetPersonaEditor;
