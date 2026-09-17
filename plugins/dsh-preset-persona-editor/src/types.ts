/**
 * The persona surface's wire types, shared by the host service and the browser
 * half.
 *
 * Every field is required and JSON-representable: `undefined` cannot cross the
 * Remote boundary, so "absent" is spelled `""`, `null`, or a literal union
 * member, never an optional property (`@deepseek-ai/dsh-typert-protocol`
 * rejects `undefined` in a wire DTO).
 * @module types
 */

/** Whether the deployment ships a preset or the user owns it. */
export type PresetTrust = "system" | "user";

/**
 * How a preset carries its persona:
 * - `none` — no persona row: the deployment's own persona applies (inherited);
 * - `local` — exactly one persona row this editor can rewrite;
 * - `ambiguous` — more than one persona row, so no single one is "the" persona;
 * - `unreadable` — the composition file is missing or is not a valid YAML list.
 */
export type PersonaState = "none" | "local" | "ambiguous" | "unreadable";

/** The four values of one `@deepseek-ai/dsh-persona` row. */
export interface PersonaDraft {
  readonly prefix: string;
  readonly suffix: string;
  readonly complete: boolean;
  readonly includeRuntimeContext: boolean;
}

/** One roster row: a preset and the persona state read from its composition. */
export interface PersonaPresetRow {
  readonly id: string;
  /** Display name the preset published; `""` when it published none. */
  readonly name: string;
  /** Description the preset published; `""` when it published none. */
  readonly description: string;
  readonly trust: PresetTrust;
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean;
  /** Whether this editor may rewrite the preset (a `user` root preset). */
  readonly editable: boolean;
  /** Why the preset cannot compose a session; `""` when it can. */
  readonly broken: string;
  readonly persona: PersonaState;
  /** `complete` of the local persona row; `false` when there is none. */
  readonly complete: boolean;
  /** Content revision of the composition file; `""` when it cannot be read. */
  readonly revision: string;
}

/** The roster plus the deployment's authoring stance. */
export interface PersonaCatalog {
  readonly presets: readonly PersonaPresetRow[];
  /** Whether the deployment configures a user-writable preset root. */
  readonly authorable: boolean;
}

/** One preset opened for editing: its persona, its file, and its context. */
export interface PersonaDocument {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly trust: PresetTrust;
  readonly editable: boolean;
  readonly isDefault: boolean;
  /** Absolute path of the composition file this editor rewrites. */
  readonly path: string;
  /** Content revision the next write must present back. */
  readonly revision: string;
  /** Whether the preset carries a persona row of its own. */
  readonly hasRow: boolean;
  /** Values read from the row; defaults when the preset has none. */
  readonly persona: PersonaDraft;
  /**
   * Config keys the row carries that this editor does not manage. They are
   * preserved by a save and dropped by a reset, so the UI discloses them.
   */
  readonly unknownKeys: readonly string[];
  /**
   * Managed keys whose value is not a plain scalar (an `!!js` expression, a
   * collection). Their presence refuses a save: rewriting them would drop the
   * expression the composition means.
   */
  readonly foreignKeys: readonly string[];
  /** Persona rows beyond the first; non-zero refuses a save. */
  readonly extraRows: number;
  /**
   * Why this preset cannot be edited at all (the file is missing or is not a
   * composition, the persona row is flow-styled, ...); `""` when it can.
   */
  readonly readError: string;
  /** The composition file's text, for the read-only file viewer. */
  readonly source: string;
  /** Order of the persona prefix section on this deployment. */
  readonly prefixOrder: number;
  /** Order of the persona suffix section on this deployment. */
  readonly suffixOrder: number;
  /** Total composition rows the preset names. */
  readonly rowCount: number;
}

/** What a successful write returns: the revision the file now has. */
export interface PersonaWriteReceipt {
  readonly revision: string;
}
