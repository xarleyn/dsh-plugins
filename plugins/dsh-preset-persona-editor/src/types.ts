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

/**
 * How a preset carries its persona:
 * - `none` — no persona row: the deployment's own persona applies (inherited);
 * - `local` — exactly one persona row this editor can read;
 * - `ambiguous` — more than one persona row, so no single one is "the" persona;
 * - `unreadable` — the composition is missing or is not a valid YAML list.
 */
export type PersonaState = "none" | "local" | "ambiguous" | "unreadable";

/** The four values of one `@deepseek-ai/dsh-persona` row. */
export interface PersonaDraft {
  readonly prefix: string;
  readonly suffix: string;
  readonly complete: boolean;
  readonly includeRuntimeContext: boolean;
}

/**
 * One prompt section a preset contributes.
 *
 * `order` places it in the assembled prompt (the harness's own vocabulary runs
 * from `-1000` for the harness identity to `10200` for the persona suffix), and
 * a section registered in an agent's scope shadows a deployment-global section
 * of the same name.
 */
export interface PromptSectionDraft {
  readonly name: string;
  readonly order: number;
  readonly text: string;
  /** `false` keeps the section in the file without registering it. */
  readonly enabled: boolean;
}

/**
 * How a preset carries its prompt sections:
 * - `none` — no sections row: the preset contributes no sections of its own;
 * - `local` — one row of this editor's, with a list it can read;
 * - `ambiguous` — more than one row names the registrar;
 * - `unreadable` — the composition itself cannot be read.
 */
export type SectionsState = "none" | "local" | "ambiguous" | "unreadable";

/** One roster row: a preset and the persona state read from its composition. */
export interface PersonaPresetRow {
  readonly id: string;
  /** Display name the preset published; `""` when it published none. */
  readonly name: string;
  /** Description the preset published; `""` when it published none. */
  readonly description: string;
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean;
  /** Why the preset cannot compose a session; `""` when it can. */
  readonly broken: string;
  readonly persona: PersonaState;
  /** `complete` of the local persona row; `false` when there is none. */
  readonly complete: boolean;
}

/** The roster as the page reads it. */
export interface PersonaCatalog {
  readonly presets: readonly PersonaPresetRow[];
}

/** One preset opened for reading: its persona, its composition, its context. */
export interface PersonaDocument {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Why the preset cannot compose a session; `""` when it can. */
  readonly broken: string;
  /**
   * Whether the registry answered for this preset and its composition parsed,
   * so the page has readings to show. Since `0.1.7-rc.2` a roster row carries
   * neither ownership nor a path, so nothing finer than this is derivable.
   */
  readonly editable: boolean;
  readonly isDefault: boolean;
  /** Whether the preset carries a persona row of its own. */
  readonly hasRow: boolean;
  /** Values read from the row; defaults when the preset has none. */
  readonly persona: PersonaDraft;
  /**
   * Config keys the row carries that this editor does not manage. The page
   * discloses them; it has no way to rewrite them.
   */
  readonly unknownKeys: readonly string[];
  /**
   * Managed keys whose value is not a plain scalar (an `!!js` expression, a
   * collection). Their presence means the row says more than this page's four
   * fields can describe.
   */
  readonly foreignKeys: readonly string[];
  /** Persona rows beyond the first; non-zero means there is no single persona. */
  readonly extraRows: number;
  /** The prompt sections the preset contributes, in composition order. */
  readonly sections: readonly PromptSectionDraft[];
  /** How the preset carries those sections. */
  readonly sectionsState: SectionsState;
  /**
   * Why the sections list is not a plain block sequence this page can read
   * (`!!js` inside it, a flow sequence, more than one sections row); `""` when
   * it is.
   */
  readonly sectionsError: string;
  /** Config keys of the sections row other than `sections`. */
  readonly sectionsUnknownKeys: readonly string[];
  /**
   * Why this preset's composition cannot be read at all (the registry refused
   * it, it is not a composition, the persona row is flow-styled, ...); `""` when
   * it can.
   */
  readonly readError: string;
  /** The composition's text, as the Host rendered it from the declarations. */
  readonly source: string;
  /** Order of the persona prefix section on this deployment. */
  readonly prefixOrder: number;
  /** Order of the persona suffix section on this deployment. */
  readonly suffixOrder: number;
  /** Total composition rows the preset names. */
  readonly rowCount: number;
}
