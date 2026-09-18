/**
 * Reading presets: the roster with each preset's persona state, and one preset
 * opened as an editable document.
 *
 * The reader never mounts a preset and never asks the loader anything: it reads
 * the same composition file a session would be composed from, so an answer here
 * means the same thing for a session created afterwards. Reads are unmemoized on
 * purpose — the roster is a live directory, and a cached answer would be the one
 * that goes stale exactly when someone edits a file by hand.
 * @module host/preset-reader
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  PERSONA_PREFIX_FALLBACK_ORDER,
  PERSONA_PREFIX_ORDER_NAME,
  PERSONA_PLUGIN_NAME,
  PERSONA_SUFFIX_FALLBACK_ORDER,
  PERSONA_SUFFIX_ORDER_NAME,
} from "../shared/persona.js";
import {
  SECTIONS_MODULE_FILE,
  SECTIONS_MODULE_SOURCE,
  SECTIONS_MODULE_SPECIFIER,
} from "../shared/prompt-sections.js";
import { splitBom } from "../shared/render.js";
import type {
  PersonaCatalog,
  PersonaDocument,
  PersonaDraft,
  PersonaPresetRow,
  PersonaState,
  PresetTrust,
  PromptSectionDraft,
  SectionsModuleState,
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

/** The fields this editor reads off one preset. */
export interface PresetEntry {
  readonly id: string;
  readonly trust: PresetTrust;
  /** Absolute path of the preset's composition file. */
  readonly path: string;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly broken?: string | undefined;
}

/** The slice of the host's `agentPresets` service this editor uses. */
export interface PresetRosterFace {
  list(): Promise<readonly PresetEntry[]>;
  resolve(id?: string): Promise<PresetEntry>;
  /** Whether the deployment configures a user-writable preset root. */
  readonly authorable: boolean;
  /** Id of the preset a session naming none composes, read live. */
  readonly defaultId: string;
  /** Duplicate a preset directory into the writable root. */
  copy(from: string, id: string, name?: string): Promise<unknown>;
}

/** The slice of the host's `systemPrompt` service this editor uses. */
export interface SystemPromptFace {
  getSectionOrder(
    name: "DEPLOYMENT_PERSONA_PREFIX" | "DEPLOYMENT_PERSONA_SUFFIX",
  ): number;
}

/** One composition file's text, byte-order mark, and content revision. */
export interface PresetFile {
  /** The text the parser sees: byte-order mark removed. */
  readonly text: string;
  /** Whether the file began with a U+FEFF. */
  readonly bom: boolean;
  /** Hash of the file's bytes, mark included. */
  readonly revision: string;
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

/** Content revision of a composition file: a hash of its bytes. */
export function revisionOf(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read one composition file.
 * @param path - absolute path of the file.
 * @returns its text, byte-order mark, and revision.
 */
export async function readPresetFile(path: string): Promise<PresetFile> {
  const bytes = await readFile(path);
  const split = splitBom(bytes.toString("utf8"));
  return {
    text: split.text,
    bom: split.bom,
    // The revision covers the file as it is on disk, mark included, so any
    // byte an outside editor changes invalidates a pending save.
    revision: revisionOf(bytes),
  };
}

/**
 * Inspect a composition's persona row.
 * @param text - the composition's text.
 * @returns the persona state and the values the row carries.
 * @throws CompositionError when the file is not an editable composition.
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

/**
 * Read the state of the registrar module beside a composition.
 * @param compositionPath - absolute path of the composition file.
 * @returns `present` for this editor's own file, `foreign` for an edited one,
 * `missing` when there is none.
 */
export async function readSectionsModule(
  compositionPath: string,
): Promise<SectionsModuleState> {
  const path = join(dirname(compositionPath), SECTIONS_MODULE_FILE);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return "missing";
  }
  return text === SECTIONS_MODULE_SOURCE ? "present" : "foreign";
}

/** The persona state of one preset, with the failure that produced it. */
interface PresetInspection {
  readonly state: PersonaState;
  readonly draft: PersonaDraft;
  readonly complete: boolean;
  readonly revision: string;
  readonly readError: string;
  readonly unknownKeys: readonly string[];
  readonly foreignKeys: readonly string[];
  readonly extraRows: number;
  readonly sections: readonly PromptSectionDraft[];
  readonly sectionsState: SectionsState;
  readonly sectionsError: string;
  readonly sectionsUnknownKeys: readonly string[];
  readonly sectionsModule: SectionsModuleState;
}

const ABSENT: {
  readonly draft: PersonaDraft;
  readonly unknownKeys: readonly string[];
  readonly foreignKeys: readonly string[];
  readonly extraRows: number;
  readonly sections: readonly PromptSectionDraft[];
  readonly sectionsState: SectionsState;
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
  sectionsState: "none",
  sectionsError: "",
  sectionsUnknownKeys: [],
};

/** Read one preset's persona and sections state, reporting every failure. */
export async function inspectPreset(
  preset: PresetEntry,
): Promise<PresetInspection> {
  const sectionsModule = await readSectionsModule(preset.path);
  let file: PresetFile;
  try {
    file = await readPresetFile(preset.path);
  } catch (cause) {
    return {
      state: "unreadable",
      complete: false,
      revision: "",
      readError: `the composition file could not be read: ${reasonOf(cause)}`,
      sectionsModule,
      ...ABSENT,
      sectionsState: "unreadable",
    };
  }
  try {
    const inspection = inspectComposition(file.text);
    return {
      state: inspection.state,
      draft: inspection.draft,
      complete: inspection.draft.complete,
      revision: file.revision,
      readError: "",
      unknownKeys: inspection.unknownKeys,
      foreignKeys: inspection.foreignKeys,
      extraRows: inspection.extraRows,
      sections: inspection.sections,
      sectionsState: inspection.sectionsState,
      sectionsError: inspection.sectionsError,
      sectionsUnknownKeys: inspection.sectionsUnknownKeys,
      sectionsModule,
    };
  } catch (cause) {
    return {
      state: "unreadable",
      complete: false,
      revision: file.revision,
      readError: reasonOf(cause),
      sectionsModule,
      ...ABSENT,
      sectionsState: "unreadable",
    };
  }
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
    const inspection = await inspectPreset(preset);
    rows.push({
      id: preset.id,
      name: preset.name ?? "",
      description: preset.description ?? "",
      trust: preset.trust,
      isDefault: preset.id === defaultId,
      editable: preset.trust === "user" && inspection.state !== "unreadable",
      broken: preset.broken ?? "",
      persona: inspection.state,
      complete: inspection.complete,
      revision: inspection.revision,
    });
  }
  return { presets: rows, authorable: roster.authorable };
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
 * One preset as an editable document: its persona values, its unmanaged keys,
 * its file, and the revision a save must present back.
 * @param roster - the host's `agentPresets` service.
 * @param systemPrompt - the host's `systemPrompt` service, when mounted.
 * @param id - the preset to open.
 * @returns the document; `readError` explains a file this editor cannot edit.
 */
export async function readDocument(
  roster: PresetRosterFace,
  systemPrompt: SystemPromptFace | undefined,
  id: string,
): Promise<PersonaDocument> {
  const preset = await resolvePreset(roster, id);
  const inspection = await inspectPreset(preset);
  const orders = personaOrders(systemPrompt);
  let source = "";
  let rowCount = 0;
  try {
    source = (await readPresetFile(preset.path)).text;
    rowCount = topLevelRowCount(source);
  } catch {
    // The viewer shows nothing when the file cannot be read at all; the
    // readError beside it already carries the reason.
  }
  return {
    id: preset.id,
    name: preset.name ?? "",
    description: preset.description ?? "",
    trust: preset.trust,
    editable: preset.trust === "user" && inspection.state !== "unreadable",
    isDefault: preset.id === roster.defaultId,
    path: preset.path,
    revision: inspection.revision,
    hasRow: inspection.state === "local",
    persona: inspection.draft,
    unknownKeys: inspection.unknownKeys,
    foreignKeys: inspection.foreignKeys,
    extraRows: inspection.extraRows,
    sections: inspection.sections,
    sectionsState: inspection.sectionsState,
    sectionsError: inspection.sectionsError,
    sectionsModule: inspection.sectionsModule,
    sectionsUnknownKeys: inspection.sectionsUnknownKeys,
    readError: inspection.readError,
    source,
    prefixOrder: orders.prefixOrder,
    suffixOrder: orders.suffixOrder,
    rowCount,
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
 * has one failure to branch on whatever the harness throws.
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
