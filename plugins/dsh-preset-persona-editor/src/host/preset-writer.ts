/**
 * Writing presets: one persona row rewritten, inserted, or removed in the
 * preset's own composition file.
 *
 * The write path is deliberately short and pessimistic:
 *  - the preset must be one the deployment lets a user own (`trust === "user"`);
 *  - the file must still carry the revision the editor read;
 *  - the new text is re-parsed and read back before it is written, so a
 *    rendering bug refuses instead of producing a composition no session can
 *    compose from;
 *  - the file is replaced atomically (a sibling temporary file plus a rename),
 *    so a failure leaves the old composition in place.
 *
 * Nothing here is a second source of truth: the persona lives in the preset's
 * composition, and this module only moves bytes inside it.
 * @module host/preset-writer
 */

import { randomUUID } from "node:crypto";
import { chmod, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { PersonaDraft, PersonaWriteReceipt } from "../types.js";
import {
  applyPersonaDraft,
  CompositionError,
  parseComposition,
  readPersonaValues,
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
  reasonOf,
  validateDraft,
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

/** Re-parse the new text and prove the values read back as intended. */
function assertReadback(id: string, text: string, draft: PersonaDraft): void {
  const parse = parseComposition(text);
  const read = readPersonaValues(parse.rows);
  const same =
    read.draft.prefix === draft.prefix &&
    read.draft.suffix === draft.suffix &&
    read.draft.complete === draft.complete &&
    read.draft.includeRuntimeContext === draft.includeRuntimeContext;
  if (parse.rows.length !== 1 || !same) {
    throw invalid(
      id,
      "the edit could not be read back from the composition; the file is unchanged",
    );
  }
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
 * Write the persona values into a preset's composition.
 * @param context - the write context.
 * @param id - the preset id.
 * @param draftInput - the values as they arrived over the wire.
 * @param expectedRevision - the revision the editor read.
 * @returns the revision the file now has.
 * @throws RemoteError on any refusal, with nothing written.
 */
export async function savePersona(
  context: WriteContext,
  id: string,
  draftInput: Partial<PersonaDraft> | undefined,
  expectedRevision: string,
): Promise<PersonaWriteReceipt> {
  const draft = normalizeDraft(id, draftInput);
  validateDraft(id, draft, context.limits);
  const guarded = await openForWrite(context, id, expectedRevision);
  let text: string;
  try {
    text = applyPersonaDraft(
      guarded.text,
      draft,
      parseComposition(guarded.text),
    );
    assertReadback(id, text, draft);
  } catch (cause) {
    if (cause instanceof CompositionError) throw invalid(id, reasonOf(cause));
    throw cause;
  }
  await guarded.assertUnchanged();
  return await commit(id, guarded, text);
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
