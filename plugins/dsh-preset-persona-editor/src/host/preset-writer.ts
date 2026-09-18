/**
 * Writing presets: the persona row and the prompt-sections row, rewritten,
 * inserted, or removed in the preset's own composition file — plus the
 * registrar module the sections row names.
 *
 * The write path is deliberately short and pessimistic:
 *  - the preset must be one the deployment lets a user own (`trust === "user"`);
 *  - the file must still carry the revision the editor read;
 *  - the new text is re-parsed and read back before it is written, so a
 *    rendering bug refuses instead of producing a composition no session can
 *    compose from;
 *  - the registrar is created before a composition that names it, and removed
 *    only when it is this editor's own file, so the preset never points at
 *    code that is not there and never loses code someone wrote themselves;
 *  - the file is replaced atomically (a sibling temporary file plus a rename),
 *    so a failure leaves the old composition in place.
 *
 * Nothing here is a second source of truth: both rows live in the preset's
 * composition, and this module only moves bytes inside it.
 * @module host/preset-writer
 */

import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { PERSONA_PLUGIN_NAME } from "../shared/persona.js";
import {
  sameSections,
  SECTIONS_MODULE_FILE,
  SECTIONS_MODULE_SOURCE,
  SECTIONS_MODULE_SPECIFIER,
} from "../shared/prompt-sections.js";
import type {
  PersonaWriteReceipt,
  PresetDraft,
  PromptSectionDraft,
} from "../types.js";
import {
  applyPersonaDraft,
  applyPromptSections,
  CompositionError,
  type CompositionParse,
  moduleRows,
  parseComposition,
  readPersonaValues,
  readPromptSections,
  removePersonaRow,
} from "./composition.js";
import { conflict, invalid, readOnly } from "./errors.js";
import {
  readPresetFile,
  revisionOf,
  resolvePreset,
  type PresetRosterFace,
} from "./preset-reader.js";
import {
  normalizeDraft,
  normalizeSections,
  reasonOf,
  validateDraft,
  validateSections,
  type PersonaLimits,
} from "./validation.js";

/** What one write needs beyond the request itself. */
export interface WriteContext {
  /** The host's `agentPresets` service. */
  readonly roster: PresetRosterFace;
  /** Operator-set ceilings. */
  readonly limits: PersonaLimits;
}

/** A revision-checked composition: the file as read, plus its write guard. */
interface GuardedComposition {
  /** Absolute path of the composition file. */
  readonly path: string;
  /** The file's text, byte-order mark split off. */
  readonly text: string;
  /** Whether the file began with a byte-order mark. */
  readonly bom: boolean;
  /** The file's mode, preserved across the replacement. */
  readonly mode: number;
  /** Refuses when the file no longer matches the revision the caller read. */
  readonly assertUnchanged: () => Promise<void>;
}

/**
 * Read a preset's composition and arm the revision guard.
 * @param context - the write context.
 * @param id - the preset id.
 * @param expectedRevision - the revision the caller read; `""` skips the check
 * only for callers that just read the file themselves.
 * @returns the text, its byte-order mark, and the guard.
 * @throws RemoteError `preset-persona/read-only` / `preset-persona/conflict`.
 */
async function openForWrite(
  context: WriteContext,
  id: string,
  expectedRevision: string,
): Promise<GuardedComposition> {
  const preset = await resolvePreset(context.roster, id);
  if (preset.trust !== "user") {
    throw readOnly(id, "it ships with the deployment");
  }
  const file = await readPresetFile(preset.path);
  if (expectedRevision !== "" && expectedRevision !== file.revision) {
    throw conflict(id, expectedRevision, file.revision);
  }
  const stats = await stat(preset.path);
  return {
    path: preset.path,
    text: file.text,
    bom: file.bom,
    mode: stats.mode & 0o777,
    assertUnchanged: async () => {
      const current = await readPresetFile(preset.path);
      if (current.revision !== file.revision) {
        throw conflict(id, file.revision, current.revision);
      }
    },
  };
}

/**
 * Replace a composition file atomically, keeping its mode.
 *
 * The temporary file is a sibling, so the rename stays within one file system;
 * a failure removes it and leaves the original composition untouched.
 * @param path - the composition file.
 * @param text - the new text.
 * @param mode - the mode to preserve.
 */
async function writeAtomic(
  path: string,
  text: string,
  mode: number,
): Promise<void> {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`,
  );
  try {
    await writeFile(temporary, text, { encoding: "utf8", mode });
    await chmod(temporary, mode);
    await rename(temporary, path);
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
}

/** Re-parse the new text and prove both halves read back as intended. */
function assertReadback(id: string, text: string, draft: PresetDraft): void {
  const parse = parseComposition(text);
  const persona = readPersonaValues(
    moduleRows(parse, PERSONA_PLUGIN_NAME).rows,
  );
  const samePersona =
    persona.draft.prefix === draft.persona.prefix &&
    persona.draft.suffix === draft.persona.suffix &&
    persona.draft.complete === draft.persona.complete &&
    persona.draft.includeRuntimeContext === draft.persona.includeRuntimeContext;
  if (!samePersona) {
    throw invalid(
      id,
      "the persona could not be read back from the composition; the file is unchanged",
    );
  }
  const sections = readPromptSections(
    moduleRows(parse, SECTIONS_MODULE_SPECIFIER).rows,
  ).sections;
  if (!sameSections(sections, draft.sections)) {
    throw invalid(
      id,
      "the prompt sections could not be read back from the composition; the file is unchanged",
    );
  }
}

/**
 * Create the registrar beside a composition when it is missing.
 *
 * A composition that names a module which is not there composes nothing, so the
 * file is written before the row that references it. An existing file is left
 * exactly as it is: it is code, a preset may ship it for its own reasons, and
 * overwriting someone's edit to keep our copy canonical would be the editor
 * reaching outside its data.
 * @param compositionPath - absolute path of the composition file.
 * @param mode - the composition's own mode, so the preset keeps one convention.
 * @returns what the file was before the call.
 */
async function ensureRegistrar(
  compositionPath: string,
  mode: number,
): Promise<"created" | "present" | "foreign"> {
  const path = join(dirname(compositionPath), SECTIONS_MODULE_FILE);
  let existing: string;
  try {
    existing = await readFile(path, "utf8");
  } catch {
    await writeFile(path, SECTIONS_MODULE_SOURCE, { encoding: "utf8", mode });
    await chmod(path, mode);
    return "created";
  }
  return existing === SECTIONS_MODULE_SOURCE ? "present" : "foreign";
}

/** Remove the registrar, but only when it is this editor's own file. */
async function dropRegistrar(compositionPath: string): Promise<void> {
  const path = join(dirname(compositionPath), SECTIONS_MODULE_FILE);
  let existing: string;
  try {
    existing = await readFile(path, "utf8");
  } catch {
    return;
  }
  if (existing !== SECTIONS_MODULE_SOURCE) return;
  await rm(path, { force: true }).catch(() => undefined);
}

/** Write the new text and report its revision. */
async function commit(
  id: string,
  guarded: GuardedComposition,
  text: string,
): Promise<PersonaWriteReceipt> {
  const write = guarded.bom ? `\uFEFF${text}` : text;
  try {
    await writeAtomic(guarded.path, write, guarded.mode);
  } catch (cause) {
    throw invalid(
      id,
      `the composition could not be written: ${reasonOf(cause)}`,
    );
  }
  return { revision: revisionOf(write) };
}

/**
 * Whether a save would leave the composition exactly as it is.
 *
 * A save on a preset that carries nothing — no persona row, no sections row,
 * and a draft that is the defaults — is not a reason to write a file: the
 * editor refuses to materialize empty rows that change nothing.
 */
function isNoOp(
  hasPersonaRow: boolean,
  hasSectionsRow: boolean,
  draft: PresetDraft,
): boolean {
  const personaIsDefault =
    draft.persona.prefix === "" &&
    draft.persona.suffix === "" &&
    !draft.persona.complete &&
    draft.persona.includeRuntimeContext;
  return (
    draft.sections.length === 0 &&
    !hasPersonaRow &&
    !hasSectionsRow &&
    personaIsDefault
  );
}

/**
 * Write the persona and the prompt sections into a preset's composition.
 * @param context - the write context.
 * @param id - the preset id.
 * @param draftInput - the draft as it arrived over the wire.
 * @param expectedRevision - the revision the editor read.
 * @returns the revision the file now has.
 * @throws RemoteError on any refusal, with nothing written.
 */
export async function savePersona(
  context: WriteContext,
  id: string,
  draftInput: Partial<PresetDraft> | undefined,
  expectedRevision: string,
): Promise<PersonaWriteReceipt> {
  const draft: PresetDraft = {
    persona: normalizeDraft(id, draftInput?.persona),
    sections: normalizeSections(
      id,
      draftInput?.sections as
        readonly Partial<PromptSectionDraft>[] | undefined,
    ),
  };
  validateDraft(id, draft.persona, context.limits);
  validateSections(id, draft.sections, context.limits);
  const guarded = await openForWrite(context, id, expectedRevision);
  let parse: CompositionParse;
  try {
    parse = parseComposition(guarded.text);
  } catch (cause) {
    if (cause instanceof CompositionError) throw invalid(id, reasonOf(cause));
    throw cause;
  }
  const hasPersonaRow = moduleRows(parse, PERSONA_PLUGIN_NAME).rows.length > 0;
  const hasSectionsRow =
    moduleRows(parse, SECTIONS_MODULE_SPECIFIER).rows.length > 0;
  const unchanged = guarded.bom ? `\uFEFF${guarded.text}` : guarded.text;
  if (isNoOp(hasPersonaRow, hasSectionsRow, draft)) {
    return { revision: revisionOf(unchanged) };
  }
  let text: string;
  try {
    text = applyPersonaDraft(guarded.text, draft.persona, parse);
    text = applyPromptSections(text, draft.sections, parseComposition(text));
    assertReadback(id, text, draft);
  } catch (cause) {
    if (cause instanceof CompositionError) throw invalid(id, reasonOf(cause));
    throw cause;
  }
  await guarded.assertUnchanged();
  // The registrar goes first: a composition that names a module which is not
  // there composes nothing at all, while an unreferenced module costs a file.
  // Removal is the other way round, once the composition stops naming it.
  if (draft.sections.length > 0) {
    await ensureRegistrar(guarded.path, guarded.mode);
  }
  const receipt = await commit(id, guarded, text);
  if (draft.sections.length === 0) {
    await dropRegistrar(guarded.path);
  }
  return receipt;
}

/**
 * Remove the persona row, so the preset inherits the deployment's persona.
 * @param context - the write context.
 * @param id - the preset id.
 * @param expectedRevision - the revision the editor read.
 * @returns the revision the file now has (unchanged when there was no row).
 * @throws RemoteError on any refusal, with nothing written.
 */
export async function resetPersona(
  context: WriteContext,
  id: string,
  expectedRevision: string,
): Promise<PersonaWriteReceipt> {
  const guarded = await openForWrite(context, id, expectedRevision);
  let text: string;
  try {
    text = removePersonaRow(guarded.text, parseComposition(guarded.text));
  } catch (cause) {
    if (cause instanceof CompositionError) throw invalid(id, reasonOf(cause));
    throw cause;
  }
  if (text === guarded.text) {
    return { revision: revisionOf(guarded.bom ? `\uFEFF${text}` : text) };
  }
  await guarded.assertUnchanged();
  return await commit(id, guarded, text);
}

/**
 * Duplicate a preset into the writable root, the way the roster's own copy
 * does, so a shipped preset can be edited as a user-owned one.
 * @param roster - the host's `agentPresets` service.
 * @param from - the preset to copy.
 * @param id - the new preset's id (its directory name).
 * @param name - display name for the copy; `""` keeps the source's name.
 * @throws RemoteError `preset-persona/invalid` when the copy is refused.
 */
export async function copyPreset(
  roster: PresetRosterFace,
  from: string,
  id: string,
  name: string,
): Promise<void> {
  try {
    await roster.copy(from, id, name === "" ? undefined : name);
  } catch (cause) {
    throw invalid(id, reasonOf(cause));
  }
}
