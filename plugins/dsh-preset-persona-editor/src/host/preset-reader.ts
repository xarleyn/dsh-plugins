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
 *
 * A registry that refuses a composition is never reduced to a bare `null`: the
 * reason travels with the read and is logged, because the refusal is the host's
 * fact and this page has no business replacing it with its own wording.
 * @module host/preset-reader
 */

import type { PluginLoggerLike } from "@yadsh/dsh-plugin-log";

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

/** Why a composition could not be read, in the host's own words. */
const NO_READ_DOCUMENT =
  "the deployment's agent-preset registry does not answer readDocument(), so no composition can be read";

/** The one logger call the reader makes. */
export type PresetReadLogger = Pick<PluginLoggerLike, "warn">;

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
 * The registry's answer for one preset's composition: the rendered text, or the
 * host's reason for refusing it.
 *
 * The two members discriminate the read — a refusal always names a reason, and
 * an answer always carries the text — so a caller cannot lose one behind the
 * other.
 */
export type CompositionRead =
  | { readonly composition: PresetComposition; readonly refusal: "" }
  | { readonly composition: null; readonly refusal: string };

/**
 * Read one preset's composition from the registry.
 * @param roster - the host's `agentPresets` service.
 * @param id - the preset to open.
 * @returns the rendered composition, or the reason the registry refused it.
 */
export async function readComposition(
  roster: PresetRosterFace,
  id: string,
): Promise<CompositionRead> {
  // The face is the one `0.1.7-rc.2` answers with, but the compatibility range
  // reaches to `<0.2.0`: a host without this method would otherwise turn every
  // preset on the roster into an unreadable row with nothing in the log.
  const read = (roster as { readDocument?: unknown }).readDocument;
  if (typeof read !== "function")
    return { composition: null, refusal: NO_READ_DOCUMENT };
  try {
    return { composition: await read.call(roster, id), refusal: "" };
  } catch (cause) {
    // A preset can be retired between the roster read and this call, and the
    // registry can refuse a composition for its own reasons. Both are the host's
    // facts, so the reason rides along instead of collapsing into a `null`.
    return { composition: null, refusal: reasonOf(cause) };
  }
}

/**
 * Inspect one preset's composition, reporting every failure the page has words
 * for.
 * @param read - the registry's answer for the preset.
 * @returns the persona and sections state of the composition.
 */
export async function inspectPreset(
  read: CompositionRead,
): Promise<PresetInspection> {
  if (read.composition === null) {
    return {
      state: "unreadable",
      complete: false,
      readError: read.refusal,
      ...ABSENT,
      sectionsState: "unreadable",
    };
  }
  try {
    const inspection = inspectComposition(read.composition.content);
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

/**
 * The roster with each preset's persona state, for the settings page.
 * @param roster - the host's `agentPresets` service.
 * @param logger - where a refused composition is reported.
 * @returns one row per preset, in the roster's own order.
 */
export async function readCatalog(
  roster: PresetRosterFace,
  logger?: PresetReadLogger,
): Promise<PersonaCatalog> {
  const presets = await roster.list();
  const defaultId = roster.defaultId;
  // Every preset's composition renders independently, and the roster is read on
  // each page load: a sequential walk would pay one YAML render after another
  // for a page that only shows the state of each row.
  const rows = await Promise.all(
    presets.map(async (preset): Promise<PersonaPresetRow> => {
      const read = await readComposition(roster, preset.id);
      if (read.refusal !== "") {
        logger?.warn("preset-persona.composition-refused", {
          agentPreset: preset.id,
          reason: read.refusal,
        });
      }
      const inspection = await inspectPreset(read);
      return {
        id: preset.id,
        name: preset.name ?? "",
        description: preset.description ?? "",
        isDefault: preset.id === defaultId,
        broken: preset.broken ?? "",
        persona: inspection.state,
        complete: inspection.complete,
      };
    }),
  );
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
 *
 * The three ways a preset answers differently than "here is its persona" stay
 * three fields: `broken` is the registry's own failure to compose a session
 * (which does not stop it rendering the composition), `readError` is the failure
 * to read that composition, and `persona` is what the composition says. The page
 * has no field that merges them: a merged answer is the one that has to be
 * described by a single sentence, and no sentence here fits all three.
 * @param roster - the host's `agentPresets` service.
 * @param systemPrompt - the host's `systemPrompt` service, when mounted.
 * @param id - the preset to open.
 * @param logger - where a refused composition is reported.
 * @returns the document; `readError` explains a composition this page cannot read.
 */
export async function readDocument(
  roster: PresetRosterFace,
  systemPrompt: SystemPromptFace | undefined,
  id: string,
  logger?: PresetReadLogger,
): Promise<PersonaDocument> {
  const preset = await resolvePreset(roster, id);
  const read = await readComposition(roster, id);
  if (read.refusal !== "") {
    logger?.warn("preset-persona.composition-refused", {
      agentPreset: id,
      reason: read.refusal,
    });
  }
  const inspection = await inspectPreset(read);
  const orders = personaOrders(systemPrompt);
  const source = read.composition?.content ?? "";
  return {
    id: preset.id,
    name: read.composition?.name ?? preset.name ?? "",
    description: read.composition?.description ?? preset.description ?? "",
    broken: preset.broken ?? "",
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
 * has one failure to branch on whatever the registry throws. The registry's own
 * reason rides on the message: it is the part a deployment log has to keep.
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
  } catch (cause) {
    throw notFound(id, reasonOf(cause));
  }
}

/** Re-exported so callers keep one import for composition failures. */
export { CompositionError };
