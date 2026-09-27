/**
 * Reading presets: the roster with each preset's persona state, and one preset
 * opened as the composition the Host renders from its declarations.
 *
 * The reader never mounts a preset, never asks the loader anything and no longer
 * touches the file system: since `0.1.7-rc.2` the registry answers `readDocument`
 * with the preset's child plugin list as entry-list YAML, which is the same
 * declaration a session composes from. It is rendered, not read — so a preset's
 * own comments, byte-order mark and hand formatting are the Loader's business,
 * and what arrives here is the effective list. Reads are unmemoized on purpose:
 * the roster is a live directory, and a cached answer would be the one that goes
 * stale exactly when a preset is registered or retired.
 * @module host/preset-reader
 */

import {
  PERSONA_PREFIX_FALLBACK_ORDER,
  PERSONA_PREFIX_ORDER_NAME,
  PERSONA_PLUGIN_NAME,
  PERSONA_SUFFIX_FALLBACK_ORDER,
  PERSONA_SUFFIX_ORDER_NAME,
} from "../shared/persona.js";
import { SECTIONS_MODULE_SPECIFIER } from "../shared/prompt-sections.js";
import type {
  PersonaCatalog,
  PersonaDocument,
  PersonaDraft,
  PersonaPresetRow,
  PersonaState,
  PromptSectionDraft,
  SectionsState,
} from "../types.js";
import {
  CompositionError,
  moduleRows,
  parseComposition,
  readPersonaValues,
  readPromptSections,
} from "./composition.js";
import { notFound } from "./errors.js";
import { reasonOf } from "./validation.js";

/** One preset as the registry's roster reports it. */
export interface PresetEntry {
  readonly id: string;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly order?: number | undefined;
  /** Why this preset cannot compose a session; absent when it can. */
  readonly broken?: string | undefined;
}

/** One declared composition, rendered by the Host for reading. */
export interface PresetComposition {
  readonly agentPreset: string;
  /** The child plugin list as entry-list YAML, `!!js` expressions included. */
  readonly content: string;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
}

/** The slice of the host's `agentPresets` service this editor uses. */
export interface PresetRosterFace {
  list(): Promise<readonly PresetEntry[]>;
  resolve(id?: string): Promise<PresetEntry>;
  /** The preset's declared composition, rendered from its own declarations. */
  readDocument(agentPreset: string): Promise<PresetComposition>;
  /** Id of the preset a session naming none composes, read live. */
  readonly defaultId: string;
}

/** The slice of the host's `systemPrompt` service this editor uses. */
export interface SystemPromptFace {
  getSectionOrder(
    name: "DEPLOYMENT_PERSONA_PREFIX" | "DEPLOYMENT_PERSONA_SUFFIX",
  ): number;
}

/** What a composition says about its persona and its prompt sections. */
export interface CompositionInspection {
  readonly state: Exclude<PersonaState, "unreadable">;
  readonly draft: PersonaDraft;
  readonly unknownKeys: readonly string[];
  readonly foreignKeys: readonly string[];
  readonly extraRows: number;
  readonly sections: readonly PromptSectionDraft[];
  readonly sectionsState: Exclude<SectionsState, "unreadable">;
  readonly sectionsError: string;
  readonly sectionsUnknownKeys: readonly string[];
}

/**
 * Inspect a composition's persona row.
 * @param text - the composition's text.
 * @returns the persona state and the values the row carries.
 * @throws CompositionError when the text is not a composition this page reads.
 */
export function inspectComposition(text: string): CompositionInspection {
  const parse = parseComposition(text);
  const persona = moduleRows(parse, PERSONA_PLUGIN_NAME).rows;
  const values = readPersonaValues(persona);
  const sections = moduleRows(parse, SECTIONS_MODULE_SPECIFIER).rows;
  const sectionValues = readPromptSections(sections);
  return {
    state:
      persona.length === 0
        ? "none"
        : persona.length === 1
          ? "local"
          : "ambiguous",
    draft: values.draft,
    unknownKeys: values.unknownKeys,
    foreignKeys: values.foreignKeys,
    extraRows: Math.max(0, persona.length - 1),
    sections: sectionValues.sections,
    sectionsState:
      sections.length === 0
        ? "none"
        : sections.length === 1
          ? "local"
          : "ambiguous",
    sectionsError: sectionValues.error,
    sectionsUnknownKeys: sectionValues.unknownKeys,
  };
}

/** The persona state of one preset, with the failure that produced it. */
interface PresetInspection {
  readonly state: PersonaState;
  readonly draft: PersonaDraft;
  readonly complete: boolean;
  readonly readError: string;
  readonly unknownKeys: readonly string[];
  readonly foreignKeys: readonly string[];
  readonly extraRows: number;
  readonly sections: readonly PromptSectionDraft[];
  readonly sectionsState: SectionsState;
  readonly sectionsError: string;
  readonly sectionsUnknownKeys: readonly string[];
}

const ABSENT: {
  readonly draft: PersonaDraft;
  readonly unknownKeys: readonly string[];
  readonly foreignKeys: readonly string[];
  readonly extraRows: number;
  readonly sections: readonly PromptSectionDraft[];
  readonly sectionsError: string;
  readonly sectionsUnknownKeys: readonly string[];
} = {
  draft: {
    prefix: "",
    suffix: "",
    complete: false,
    includeRuntimeContext: true,
  },
  unknownKeys: [],
  foreignKeys: [],
  extraRows: 0,
  sections: [],
  sectionsError: "",
  sectionsUnknownKeys: [],
};

/**
 * Read one preset's composition from the registry.
 * @param roster - the host's `agentPresets` service.
 * @param id - the preset to open.
 * @returns the rendered composition, or `null` when the registry refuses it.
 */
export async function readComposition(
  roster: PresetRosterFace,
  id: string,
): Promise<PresetComposition | null> {
  try {
    return await roster.readDocument(id);
  } catch {
    // A preset can be retired between the roster read and this call; the row
    // then carries no readings, which is what `unreadable` means here.
    return null;
  }
}

/**
 * Inspect one preset's composition, reporting every failure the page has words
 * for.
 * @param composition - the rendered composition, or `null` when refused.
 * @returns the persona and sections state of the composition.
 */
export async function inspectPreset(
  composition: PresetComposition | null,
): Promise<PresetInspection> {
  if (composition === null) {
    return {
      state: "unreadable",
      complete: false,
      readError: "the registry returned no composition for this preset",
      ...ABSENT,
      sectionsState: "unreadable",
    };
  }
  try {
    const inspection = inspectComposition(composition.content);
    return {
      state: inspection.state,
      draft: inspection.draft,
      complete: inspection.draft.complete,
      readError: "",
      unknownKeys: inspection.unknownKeys,
      foreignKeys: inspection.foreignKeys,
      extraRows: inspection.extraRows,
      sections: inspection.sections,
      sectionsState: inspection.sectionsState,
      sectionsError: inspection.sectionsError,
      sectionsUnknownKeys: inspection.sectionsUnknownKeys,
    };
  } catch (cause) {
    return {
      state: "unreadable",
      complete: false,
      readError: reasonOf(cause),
      ...ABSENT,
      sectionsState: "unreadable",
    };
  }
}

/** Whether a composition a page can read stands behind this preset. */
function isReadable(
  broken: string,
  composition: PresetComposition | null,
  state: PersonaState,
): boolean {
  return broken === "" && composition !== null && state !== "unreadable";
}

/**
 * The roster with each preset's persona state, for the settings page.
 * @param roster - the host's `agentPresets` service.
 * @returns one row per preset, in the roster's own order.
 */
export async function readCatalog(
  roster: PresetRosterFace,
): Promise<PersonaCatalog> {
  const presets = await roster.list();
  const defaultId = roster.defaultId;
  const rows: PersonaPresetRow[] = [];
  for (const preset of presets) {
    const broken = preset.broken ?? "";
    const composition = await readComposition(roster, preset.id);
    const inspection = await inspectPreset(composition);
    rows.push({
      id: preset.id,
      name: preset.name ?? "",
      description: preset.description ?? "",
      isDefault: preset.id === defaultId,
      broken,
      persona: inspection.state,
      complete: inspection.complete,
    });
  }
  return { presets: rows };
}

/** The section orders the preview outline places the persona around. */
export function personaOrders(systemPrompt: SystemPromptFace | undefined): {
  readonly prefixOrder: number;
  readonly suffixOrder: number;
} {
  return {
    prefixOrder:
      systemPrompt?.getSectionOrder(PERSONA_PREFIX_ORDER_NAME) ??
      PERSONA_PREFIX_FALLBACK_ORDER,
    suffixOrder:
      systemPrompt?.getSectionOrder(PERSONA_SUFFIX_ORDER_NAME) ??
      PERSONA_SUFFIX_FALLBACK_ORDER,
  };
}

/**
 * One preset as a document: its persona values, its unmanaged keys, the
 * composition the Host renders for it, and what the deployment places around it.
 * @param roster - the host's `agentPresets` service.
 * @param systemPrompt - the host's `systemPrompt` service, when mounted.
 * @param id - the preset to open.
 * @returns the document; `readError` explains a composition this page cannot read.
 */
export async function readDocument(
  roster: PresetRosterFace,
  systemPrompt: SystemPromptFace | undefined,
  id: string,
): Promise<PersonaDocument> {
  const preset = await resolvePreset(roster, id);
  const composition = await readComposition(roster, id);
  const inspection = await inspectPreset(composition);
  const orders = personaOrders(systemPrompt);
  const broken = preset.broken ?? "";
  const source = composition?.content ?? "";
  return {
    id: preset.id,
    name: composition?.name ?? preset.name ?? "",
    description: composition?.description ?? preset.description ?? "",
    broken,
    editable: isReadable(broken, composition, inspection.state),
    isDefault: preset.id === roster.defaultId,
    hasRow: inspection.state === "local",
    persona: inspection.draft,
    unknownKeys: inspection.unknownKeys,
    foreignKeys: inspection.foreignKeys,
    extraRows: inspection.extraRows,
    sections: inspection.sections,
    sectionsState: inspection.sectionsState,
    sectionsError: inspection.sectionsError,
    sectionsUnknownKeys: inspection.sectionsUnknownKeys,
    readError: inspection.readError,
    source,
    prefixOrder: orders.prefixOrder,
    suffixOrder: orders.suffixOrder,
    rowCount: topLevelRowCount(source),
  };
}

/** How many top-level rows a composition names; `0` when it cannot be parsed. */
function topLevelRowCount(text: string): number {
  if (text === "") return 0;
  try {
    const contents = parseComposition(text).document.contents;
    const items = (contents as { items?: readonly unknown[] } | null)?.items;
    return items?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Resolve a preset id, reporting the editor's own not-found code so a client
 * has one failure to branch on whatever the registry throws.
 * @param roster - the host's `agentPresets` service.
 * @param id - the preset id.
 * @returns the resolved preset.
 * @throws RemoteError `preset-persona/not-found`.
 */
export async function resolvePreset(
  roster: PresetRosterFace,
  id: string,
): Promise<PresetEntry> {
  try {
    return await roster.resolve(id);
  } catch {
    throw notFound(id);
  }
}

/** Re-exported so callers keep one import for composition failures. */
export { CompositionError };
