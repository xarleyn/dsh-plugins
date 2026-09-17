/**
 * `@yadsh/dsh-preset-persona-editor`: edit an agent preset's persona — prefix,
 * suffix, complete mode, and the runtime-context toggle — from the settings UI.
 *
 * The Cordis entrypoint. The plugin registers `ctx.presetPersonaEditor` and
 * nothing else: no prompt section, no tool, no listener. The persona a session
 * actually receives is the one `@deepseek-ai/dsh-persona` composes from the
 * preset's own composition, and this plugin's only job is to write that row
 * into `agent.cordis.yml` on request. Uninstalling it leaves every edited
 * preset working exactly as edited.
 */

import { PresetPersonaEditor } from "./host/service.js";

export {
  PresetPersonaEditor,
  ConfigSchema,
  DEFAULT_MAX_PERSONA_BYTES,
} from "./host/service.js";
export type { Config, PresetPersonaEditorDeps } from "./host/service.js";
export {
  normalizeDraft,
  DEFAULT_LIMITS,
  reasonOf,
  validateDraft,
  type PersonaLimits,
} from "./host/validation.js";
export {
  applyPersonaDraft,
  CompositionError,
  parseComposition,
  readPersonaValues,
  removePersonaRow,
  type CompositionParse,
  type PersonaConfigKey,
  type PersonaRow,
  type PersonaRowValues,
} from "./host/composition.js";
export {
  inspectComposition,
  inspectPreset,
  personaOrders,
  readCatalog,
  readDocument,
  readPresetFile,
  revisionOf,
  type CompositionInspection,
  type PresetEntry,
  type PresetFile,
  type PresetRosterFace,
  type SystemPromptFace,
} from "./host/preset-reader.js";
export {
  copyPreset,
  resetPersona,
  savePersona,
  type WriteContext,
} from "./host/preset-writer.js";
export {
  conflict,
  invalid,
  notFound,
  readOnly,
  unavailable,
} from "./host/errors.js";
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
  PersonaWriteReceipt,
  PresetTrust,
} from "./types.js";

/** Cordis plugin name (the unscoped runtime id of the bundle patch). */
export const name = "preset-persona-editor";

/** Services this plugin reads; the roster is the one it cannot work without. */
export const inject: readonly string[] = ["agentPresets", "systemPrompt"];

export default PresetPersonaEditor;
