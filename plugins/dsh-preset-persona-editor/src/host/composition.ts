/**
 * Surgical edits of one preset composition: read the persona row and the
 * prompt-sections row, rewrite the values they own, insert a row when the
 * preset has none, and remove one on reset.
 *
 * Why not a YAML round-trip: a preset composition is not data. It carries
 * comments that explain the deployment, `!!js` expression scalars, `{{cwd}}`
 * templates, block literals with deliberate chomping, and its own spacing. An
 * emitter round-trip would silently rewrite every one of them. So the document
 * is parsed for *positions* only, and the text is spliced: each managed value's
 * byte range is replaced, and every other byte of the file stays untouched.
 *
 * The parser is configured with a catch-all tag so `!!js` scalars parse (as
 * tagged values this module then refuses to rewrite) instead of failing the
 * whole document.
 * @module host/composition
 */

import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Node,
  type Pair,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";

import {
  PERSONA_MANAGED_KEYS,
  PERSONA_PLUGIN_NAME,
} from "../shared/persona.js";
import {
  renderSectionsList,
  SECTIONS_CONFIG_KEY,
  SECTIONS_MODULE_SPECIFIER,
  SECTIONS_ROW_ID,
} from "../shared/prompt-sections.js";
import {
  detectEol,
  renderConfigBlock,
  renderPersonaRow,
  renderScalar,
} from "../shared/render.js";
import type { PersonaDraft, PromptSectionDraft } from "../types.js";

/** A composition this editor refuses to touch, with the reason to show. */
export class CompositionError extends Error {
  override readonly name = "CompositionError";
}

/**
 * Catch-all for the composition's own tags.
 *
 * A preset composition carries `!!js` scalars — JavaScript expressions to the
 * Cordis loader. Left unresolved they are a parser *warning* (the node keeps
 * its tag and its source text), which is exactly the treatment this module
 * wants: the expression is opaque here, and the readers refuse to rewrite any
 * tagged scalar. Resolving them instead would hand this module a value it must
 * not touch as if it were a plain string.
 */

/** One key of a managed row's config, with the range a rewrite would replace. */
export interface RowConfigKey {
  readonly key: string;
  /** `string`/`boolean` for plain scalars; `foreign` for everything else. */
  readonly kind: "string" | "boolean" | "foreign";
  /** The value for `string`; `""` for the other kinds. */
  readonly text: string;
  /** The value for `boolean`; `false` for the other kinds. */
  readonly flag: boolean;
  /** Offset where the value's source text starts. */
  readonly valueStart: number;
  /** Offset just past the value's source text. */
  readonly valueEnd: number;
}

/** One top-level composition row. */
export interface CompositionRow {
  /** Module specifier the row names, exactly as written. */
  readonly name: string;
  /** Offset of the row's first character (the first key, past the `-`). */
  readonly start: number;
  /** Offset just past the row's last character. */
  readonly end: number;
  /** Offset of the line that carries the row's `-` indicator. */
  readonly lineStart: number;
  /** Column the row's `-` indicator starts at. */
  readonly rowIndent: number;
  /** Column the row's own keys start at (`id`, `name`, `config`, ...). */
  readonly keyIndent: number;
  /** Offset just past the row's last key or value — its mapping's end. */
  readonly anchorEnd: number;
  /** The row's `config` mapping, when it has one. */
  readonly config: YAMLMap | undefined;
  /** Column the config keys start at (valid when `config` is present). */
  readonly configIndent: number;
  /** The row's config keys, in document order. */
  readonly keys: readonly RowConfigKey[];
}

/** A parsed composition: the document tree and its top-level rows. */
export interface CompositionParse {
  readonly document: Document;
  /** Top-level rows, whatever they name. */
  readonly rows: readonly CompositionRow[];
}

/** Read the offset of the line that contains `index`. */
function lineStartAt(text: string, index: number): number {
  return text.lastIndexOf("\n", index - 1) + 1;
}

/** Column of the first non-space character at `index`. */
function indentAt(text: string, index: number): number {
  const start = lineStartAt(text, index);
  let column = 0;
  while (text[start + column] === " ") column += 1;
  return column;
}

/** Offset just past the line terminator of the line containing `index`. */
function afterLineAt(text: string, index: number): number {
  const newline = text.indexOf("\n", index);
  return newline === -1 ? text.length : newline + 1;
}

/** The `[start, end]` range of a node, or a failure when the parser gave none. */
function rangeOf(node: Node, what: string): readonly [number, number] {
  const range = node.range;
  if (range === undefined || range === null) {
    throw new CompositionError(`${what} has no source range`);
  }
  return [range[0], range[1]];
}

/** The last offset the row's own mapping occupies. */
function mapAnchorEnd(map: YAMLMap): number {
  const pairs = map.items as Pair[];
  const last = pairs[pairs.length - 1];
  if (last === undefined) return rangeOf(map, "composition row")[1];
  const value = last.value as Node | null;
  if (value !== null && value.range !== undefined && value.range !== null) {
    return rangeOf(value, "row value")[1];
  }
  return rangeOf(last.key as Node, "row key")[1];
}

/** Read one value node into {@link RowConfigKey}. */
function readKeyValue(
  key: string,
  value: Node | null,
  keyNode: Node,
): RowConfigKey {
  const [, keyEnd] = rangeOf(keyNode, `config key ${key}`);
  if (value === null) {
    // `prefix:` with nothing after it: a null value with no text to replace.
    return {
      key,
      kind: "foreign",
      text: "",
      flag: false,
      valueStart: keyEnd,
      valueEnd: keyEnd,
    };
  }
  const [valueStart, valueEnd] = rangeOf(value, `config key ${key}`);
  if (isScalar(value) && value.tag === undefined) {
    if (typeof value.value === "string") {
      return {
        key,
        kind: "string",
        text: value.value,
        flag: false,
        valueStart,
        valueEnd,
      };
    }
    if (typeof value.value === "boolean") {
      return {
        key,
        kind: "boolean",
        text: "",
        flag: value.value,
        valueStart,
        valueEnd,
      };
    }
  }
  return { key, kind: "foreign", text: "", flag: false, valueStart, valueEnd };
}

/** Read one map's keys into {@link RowConfigKey}s. */
function readConfigKeys(map: YAMLMap): RowConfigKey[] {
  const keys: RowConfigKey[] = [];
  for (const pair of map.items as Pair[]) {
    const keyNode = pair.key;
    if (!isScalar(keyNode) || typeof keyNode.value !== "string") continue;
    keys.push(readKeyValue(keyNode.value, pair.value as Node | null, keyNode));
  }
  return keys;
}

/** Read a row node into {@link CompositionRow}. */
function readRow(text: string, node: Node): CompositionRow | undefined {
  if (!isMap(node)) return undefined;
  const namePair = node.items.find(
    (pair) => isScalar(pair.key) && pair.key.value === "name",
  );
  const nameValue = namePair?.value;
  if (!isScalar(nameValue) || typeof nameValue.value !== "string") {
    return undefined;
  }
  const [start, end] = rangeOf(node, "composition row");
  const lineStart = lineStartAt(text, start);
  if (!/^[ \t]*-(\s|$)/u.test(text.slice(lineStart, start))) {
    throw new CompositionError(
      "a composition row does not start a sequence item; the composition is not a plain block list",
    );
  }
  const nameKey = namePair?.key as Node;
  const nameKeyStart = rangeOf(nameKey, "row name")[0];
  const keyIndent = nameKeyStart - lineStartAt(text, nameKeyStart);
  const rowIndent = indentAt(text, start);
  const configPair = node.items.find(
    (pair) => isScalar(pair.key) && pair.key.value === "config",
  );
  const config = configPair?.value as Node | null | undefined;
  if (config !== undefined && config !== null && isMap(config)) {
    if (config.flow === true) {
      throw new CompositionError(
        "a composition row writes its config in flow style; this editor rewrites block mappings only",
      );
    }
    return {
      name: nameValue.value,
      start,
      end,
      lineStart,
      rowIndent,
      keyIndent,
      anchorEnd: mapAnchorEnd(node),
      config,
      configIndent: indentAt(text, rangeOf(config, "row config")[0]),
      keys: readConfigKeys(config),
    };
  }
  return {
    name: nameValue.value,
    start,
    end,
    lineStart,
    rowIndent,
    keyIndent,
    anchorEnd: mapAnchorEnd(node),
    config: undefined,
    configIndent: keyIndent + 2,
    keys: [],
  };
}

/** Count rows naming one module at any depth, nested groups included. */
function countDeepRows(node: Node | null, module: string): number {
  if (node === null) return 0;
  if (isMap(node)) {
    const isTarget = node.items.some(
      (pair) =>
        isScalar(pair.key) &&
        pair.key.value === "name" &&
        isScalar(pair.value) &&
        pair.value.value === module,
    );
    let count = isTarget ? 1 : 0;
    for (const pair of node.items) {
      count += countDeepRows(pair.value as Node | null, module);
    }
    return count;
  }
  if (isSeq(node)) {
    let count = 0;
    for (const item of node.items)
      count += countDeepRows(item as Node | null, module);
    return count;
  }
  return 0;
}

/**
 * Parse a composition into positions.
 * @param text - the composition file's text, byte-order mark already split off.
 * @returns the document and its top-level rows.
 * @throws CompositionError when the text is not a YAML block list.
 */
export function parseComposition(text: string): CompositionParse {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    const first = document.errors[0];
    throw new CompositionError(
      `the composition is not valid YAML: ${first?.message ?? "unknown error"}`,
    );
  }
  const contents = document.contents;
  if (contents === null) {
    // An empty file is an empty composition: the editor may still append a row.
    return { document, rows: [] };
  }
  if (!isSeq(contents)) {
    throw new CompositionError(
      "the composition is not a YAML list of plugin rows",
    );
  }
  if ((contents as YAMLSeq).flow === true) {
    throw new CompositionError(
      "the composition is written as a flow sequence; this editor rewrites block lists only",
    );
  }
  const rows: CompositionRow[] = [];
  for (const item of (contents as YAMLSeq).items) {
    const node = item as Node | null;
    if (node === null || node.range === undefined) continue;
    const row = readRow(text, node);
    if (row !== undefined) rows.push(row);
  }
  return { document, rows };
}

/** The rows naming one module, and how many more hide inside groups. */
export interface ModuleRows {
  /** Top-level rows naming the module. */
  readonly rows: readonly CompositionRow[];
  /** Rows naming the module at any depth, nested groups included. */
  readonly deep: number;
}

/**
 * The rows naming one module. Reading a composition never throws for a nested
 * row — the preset is still a preset — so the count travels beside the rows and
 * only a rewrite refuses one.
 * @param parse - the parsed composition.
 * @param module - module specifier the rows must name.
 * @returns the top-level rows and the total count at any depth.
 */
export function moduleRows(
  parse: CompositionParse,
  module: string,
): ModuleRows {
  const contents = parse.document.contents;
  return {
    rows: parse.rows.filter((row) => row.name === module),
    deep: contents === null ? 0 : countDeepRows(contents, module),
  };
}

/**
 * The single row a rewrite may touch, or none.
 * @param parse - the parsed composition.
 * @param module - module specifier the row names.
 * @param label - how the row is named in a refusal.
 * @returns the row, or undefined when the composition has none.
 * @throws CompositionError when the composition carries more than one.
 */
function requireSingleRow(
  parse: CompositionParse,
  module: string,
  label: string,
): CompositionRow | undefined {
  const { rows, deep } = moduleRows(parse, module);
  if (deep > rows.length) {
    throw new CompositionError(
      `another ${module} row is nested inside a group; ${label} cannot be edited here`,
    );
  }
  if (rows.length > 1) {
    throw new CompositionError(
      `the composition names more than one ${module} row; ${label} cannot be edited here`,
    );
  }
  return rows[0];
}

/** One text edit: replace `[start, end)` with `text` (an insertion when equal). */
interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Apply edits back-to-front so earlier offsets stay valid. */
function applyEdits(text: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let out = text;
  for (const edit of ordered) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/**
 * Match the replaced region's own line termination.
 *
 * A block scalar's source range carries the newline that ends its last content
 * line, while a plain or quoted scalar's range carries none: a replacement that
 * ignores the difference either swallows the next line or leaves a blank one.
 * @param text - the document the region belongs to.
 * @param rendered - the value as the renderer produced it.
 * @param start - region start.
 * @param end - region end.
 * @param eol - the document's line ending.
 * @returns the rendered value with the region's termination.
 */
function matchLineTerminator(
  text: string,
  rendered: string,
  start: number,
  end: number,
  eol: string,
): string {
  const region = text.slice(start, end);
  const regionEndsLine = region.endsWith("\n");
  if (regionEndsLine && !rendered.endsWith(eol)) return `${rendered}${eol}`;
  if (!regionEndsLine && rendered.endsWith(eol)) {
    return rendered.slice(0, -eol.length);
  }
  return rendered;
}

/**
 * An edit that places whole lines after the line holding `anchor`, keeping the
 * file's own line-ending convention (a value that ends the file without a
 * terminator is closed first).
 */
function insertBlock(
  text: string,
  anchor: number,
  block: string,
  eol: string,
): readonly Edit[] {
  // A block scalar's range already ends past its own line terminator while a
  // plain value's range ends before it, so the anchor itself is the insertion
  // point in the first case and the end of its line in the second. Treating
  // both the same way strands the appended keys after the blank line that
  // follows a block scalar.
  const at = text[anchor - 1] === "\n" ? anchor : afterLineAt(text, anchor);
  const terminated = at > 0 && text[at - 1] === "\n";
  return [
    {
      start: at,
      end: at,
      text: terminated ? `${block}${eol}` : `${eol}${block}${eol}`,
    },
  ];
}

/** Append a fresh row to a composition. */
function appendRow(text: string, row: string, eol: string): string {
  if (text === "") return row;
  const body = text.endsWith("\n") ? text : `${text}${eol}`;
  // One blank line separates the new row from the composition's tail, matching
  // how a hand-written composition spaces its rows.
  const gap = body.endsWith(`${eol}${eol}`) ? "" : eol;
  return `${body}${gap}${row}`;
}

/** Remove one row, collapsing the blank lines it leaves behind. */
function removeRow(text: string, row: CompositionRow, eol: string): string {
  let end = row.end;
  if (text[end] === "\r") end += 1;
  if (text[end] === "\n") end += 1;
  return collapseGap(
    text.slice(0, row.lineStart) + text.slice(end),
    row.lineStart,
    eol,
  );
}

/**
 * Collapse the blank lines a removal leaves behind, without touching spacing
 * anywhere else in the file: only the join point is examined.
 *
 * Three cases matter, all of them local to the join: an interior run of blank
 * lines becomes a single blank separator, a run that ends the file becomes one
 * terminator, and a run that opens the file becomes none.
 * @param text - the text after the removal.
 * @param join - offset where the removed row's line started.
 * @param eol - the document's line ending.
 * @returns the text with the join point tidied.
 */
function collapseGap(text: string, join: number, eol: string): string {
  const terminator = eol === "\r\n" ? "\r\n" : "\n";
  const escaped = terminator === "\r\n" ? "\\r\\n" : "\\n";
  const run = `(?:${escaped})+`;
  const from = Math.max(0, join - terminator.length * 2);
  const to = Math.min(text.length, join + terminator.length * 4);
  let window = text.slice(from, to);
  // Two or more blank lines at the join become one blank separator.
  window = window.replace(
    new RegExp(`${run}${run}${run}`, "u"),
    `${terminator}${terminator}`,
  );
  if (to === text.length) {
    // A run that now ends the file leaves exactly one terminator.
    window = window.replace(new RegExp(`${run}$`, "u"), terminator);
  }
  if (from === 0) {
    // A run that now opens the file leaves none.
    window = window.replace(new RegExp(`^${run}`, "u"), "");
  }
  if (window === text.slice(from, to)) return text;
  return text.slice(0, from) + window + text.slice(to);
}

/* ────────────────────────────── persona row ────────────────────────────── */

/** The managed values one persona row carries. */
export interface PersonaRowValues {
  readonly draft: PersonaDraft;
  /** Config keys the row carries that this editor does not own. */
  readonly unknownKeys: readonly string[];
  /** Owned keys whose value is not a plain scalar. */
  readonly foreignKeys: readonly string[];
}

/** The persona rows of one composition. */
export function personaRows(
  parse: CompositionParse,
): readonly CompositionRow[] {
  return moduleRows(parse, PERSONA_PLUGIN_NAME).rows;
}

/**
 * Read the persona values out of a parsed composition.
 * @param rows - the composition's persona rows.
 * @returns the row's values (defaults when there is no row) and its unmanaged
 * and unrewritable keys.
 */
export function readPersonaValues(
  rows: readonly CompositionRow[],
): PersonaRowValues {
  const draft: PersonaDraft = {
    prefix: "",
    suffix: "",
    complete: false,
    includeRuntimeContext: true,
  };
  const row = rows[0];
  if (row === undefined) {
    return { draft, unknownKeys: [], foreignKeys: [] };
  }
  const found = new Map(row.keys.map((entry) => [entry.key, entry]));
  const text = (key: string): string => {
    const entry = found.get(key);
    return entry?.kind === "string" ? entry.text : "";
  };
  const flag = (key: string, fallback: boolean): boolean => {
    const entry = found.get(key);
    return entry?.kind === "boolean" ? entry.flag : fallback;
  };
  return {
    draft: {
      prefix: text("prefix"),
      suffix: text("suffix"),
      complete: flag("complete", false),
      includeRuntimeContext: flag("includeRuntimeContext", true),
    },
    unknownKeys: row.keys
      .filter(
        (entry) =>
          !(PERSONA_MANAGED_KEYS as readonly string[]).includes(entry.key),
      )
      .map((entry) => entry.key),
    foreignKeys: row.keys
      .filter(
        (entry) =>
          (PERSONA_MANAGED_KEYS as readonly string[]).includes(entry.key) &&
          entry.kind === "foreign",
      )
      .map((entry) => entry.key),
  };
}

/**
 * Rewrite the persona row with the given values, inserting the row when the
 * composition has none.
 * @param text - the composition's text.
 * @param draft - the values to write.
 * @param parse - a parse of the same text (callers reuse theirs).
 * @returns the new composition text.
 * @throws CompositionError when the composition cannot be edited safely.
 */
export function applyPersonaDraft(
  text: string,
  draft: PersonaDraft,
  parse: CompositionParse,
): string {
  const eol = detectEol(text);
  const row = requireSingleRow(parse, PERSONA_PLUGIN_NAME, "the persona");
  if (row === undefined) {
    return appendRow(text, renderPersonaRow(draft, 0, eol), eol);
  }
  const values = readPersonaValues([row]);
  if (values.foreignKeys.length > 0) {
    throw new CompositionError(
      `the persona row's ${values.foreignKeys.join(", ")} is not a plain value; edit the composition file directly`,
    );
  }
  return rewriteRow(text, draft, row, eol);
}

/** Rewrite the managed values of an existing persona row. */
function rewriteRow(
  text: string,
  draft: PersonaDraft,
  row: CompositionRow,
  eol: string,
): string {
  const rendered: Record<string, string> = {
    prefix: renderScalar(draft.prefix, row.configIndent, eol),
    suffix: renderScalar(draft.suffix, row.configIndent, eol),
    complete: draft.complete ? "true" : "false",
    includeRuntimeContext: draft.includeRuntimeContext ? "true" : "false",
  };
  const edits: Edit[] = [];
  const owned = new Set<string>(PERSONA_MANAGED_KEYS);
  for (const entry of row.keys) {
    if (!owned.has(entry.key)) continue;
    edits.push({
      start: entry.valueStart,
      end: entry.valueEnd,
      text: matchLineTerminator(
        text,
        rendered[entry.key] ?? "",
        entry.valueStart,
        entry.valueEnd,
        eol,
      ),
    });
  }
  if (row.config === undefined) {
    // No config mapping yet: hang one off the row's own mapping, after its
    // last key, at the indent the row already uses.
    const pad = " ".repeat(row.keyIndent);
    const block = [
      `${pad}config:`,
      renderConfigBlock(draft, row.keyIndent + 2, eol),
    ].join(eol);
    edits.push(...insertBlock(text, row.anchorEnd, block, eol));
    return applyEdits(text, edits);
  }
  const missing = PERSONA_MANAGED_KEYS.filter(
    (key) => !row.keys.some((entry) => entry.key === key),
  );
  if (missing.length > 0) {
    const pad = " ".repeat(row.configIndent);
    const block = missing
      .map((key) => `${pad}${key}: ${rendered[key] ?? ""}`)
      .join(eol);
    edits.push(...insertBlock(text, row.anchorEnd, block, eol));
  }
  return applyEdits(text, edits);
}

/**
 * Remove the persona row from a composition.
 * @param text - the composition's text.
 * @param parse - a parse of the same text.
 * @returns the new text (unchanged when there was no row).
 * @throws CompositionError when the composition cannot be edited safely.
 */
export function removePersonaRow(
  text: string,
  parse: CompositionParse,
): string {
  const row = requireSingleRow(parse, PERSONA_PLUGIN_NAME, "the persona");
  if (row === undefined) return text;
  return removeRow(text, row, detectEol(text));
}

/* ───────────────────────── prompt-sections row ─────────────────────────── */

/** The sections one preset contributes. */
export interface SectionsRowValues {
  readonly sections: readonly PromptSectionDraft[];
  /** Config keys of the row other than `sections`. */
  readonly unknownKeys: readonly string[];
  /**
   * Why the list cannot be rewritten: a managed entry is not a plain scalar,
   * or the list itself is not a block sequence.
   */
  readonly error: string;
}

/** Whether one sequence item is a section this editor can rewrite. */
function readSectionItem(item: Node | null): PromptSectionDraft | undefined {
  if (item === null || !isMap(item) || item.flow === true) return undefined;
  const values = new Map<string, unknown>();
  for (const pair of item.items as Pair[]) {
    const key = pair.key;
    if (!isScalar(key) || typeof key.value !== "string") return undefined;
    const value = pair.value as Node | null;
    if (value === null || !isScalar(value) || value.tag !== undefined)
      return undefined;
    values.set(key.value, value.value);
  }
  const name = values.get("name");
  const order = values.get("order");
  const text = values.get("text");
  const enabled = values.get("enabled");
  if (typeof name !== "string" || name === "") return undefined;
  if (typeof order !== "number" || !Number.isFinite(order)) return undefined;
  if (typeof text !== "string") return undefined;
  if (enabled !== undefined && typeof enabled !== "boolean") return undefined;
  return { name, order, text, enabled: enabled ?? true };
}

/** The sections row of one composition. */
export function sectionsRows(
  parse: CompositionParse,
): readonly CompositionRow[] {
  return moduleRows(parse, SECTIONS_MODULE_SPECIFIER).rows;
}

/**
 * Read the prompt sections out of a parsed composition.
 * @param rows - the composition's sections rows.
 * @returns the sections in file order, the row's unmanaged keys, and why the
 * list cannot be rewritten (when it cannot).
 */
export function readPromptSections(
  rows: readonly CompositionRow[],
): SectionsRowValues {
  const row = rows[0];
  if (row === undefined) {
    return { sections: [], unknownKeys: [], error: "" };
  }
  const unknownKeys = row.keys
    .filter((entry) => entry.key !== SECTIONS_CONFIG_KEY)
    .map((entry) => entry.key);
  // The list itself is a collection, which the scalar-key reader calls
  // `foreign`; the node is what matters here, so it is read directly.
  const pair = row.config?.items.find(
    (candidate) =>
      isScalar(candidate.key) && candidate.key.value === SECTIONS_CONFIG_KEY,
  );
  const list = (pair?.value ?? null) as Node | null;
  if (pair === undefined || row.config === undefined) {
    return { sections: [], unknownKeys, error: "" };
  }
  if (list === null || !isSeq(list)) {
    return {
      sections: [],
      unknownKeys,
      error: "the sections list is not a plain block sequence",
    };
  }
  if ((list as YAMLSeq).flow === true) {
    return {
      sections: [],
      unknownKeys,
      error: "the sections list is written as a flow sequence",
    };
  }
  const sections: PromptSectionDraft[] = [];
  for (const item of (list as YAMLSeq).items) {
    const section = readSectionItem(item as Node | null);
    if (section === undefined) {
      return {
        sections: [],
        unknownKeys,
        error: "a section in the list is not a plain name/order/text entry",
      };
    }
    sections.push(section);
  }
  return { sections, unknownKeys, error: "" };
}

/** Render a whole sections row for a composition that has none. */
function renderSectionsRow(
  sections: readonly PromptSectionDraft[],
  eol: string,
): string {
  return (
    [
      `- id: ${SECTIONS_ROW_ID}`,
      `  name: ${renderScalar(SECTIONS_MODULE_SPECIFIER, 2, eol)}`,
      "  config:",
      `    ${SECTIONS_CONFIG_KEY}:`,
      renderSectionsList(sections, 6, eol),
    ].join(eol) + eol
  );
}

/**
 * Rewrite the prompt-sections list, inserting the row when the composition has
 * none. An empty list removes the row: a preset with no sections of its own
 * carries no registrar.
 * @param text - the composition's text.
 * @param sections - the sections to write, in order.
 * @param parse - a parse of the same text (callers reuse theirs).
 * @returns the new composition text.
 * @throws CompositionError when the composition cannot be edited safely.
 */
export function applyPromptSections(
  text: string,
  sections: readonly PromptSectionDraft[],
  parse: CompositionParse,
): string {
  const eol = detectEol(text);
  const row = requireSingleRow(
    parse,
    SECTIONS_MODULE_SPECIFIER,
    "the prompt sections",
  );
  if (sections.length === 0) {
    return row === undefined ? text : removeRow(text, row, eol);
  }
  if (row === undefined) {
    return appendRow(text, renderSectionsRow(sections, eol), eol);
  }
  const values = readPromptSections([row]);
  if (values.error !== "") {
    throw new CompositionError(
      `${values.error}; edit the composition file directly`,
    );
  }
  // The list's own node carries the range a replacement needs; the scalar-key
  // reader classifies a collection as `foreign` and would refuse it.
  const list = (row.config?.items.find(
    (pair) => isScalar(pair.key) && pair.key.value === SECTIONS_CONFIG_KEY,
  )?.value ?? null) as Node | null;
  if (row.config === undefined) {
    // The row exists but carries no config at all: add the mapping and the key.
    const pad = " ".repeat(row.keyIndent);
    const block = [
      `${pad}config:`,
      `${" ".repeat(row.keyIndent + 2)}${SECTIONS_CONFIG_KEY}:`,
      renderSectionsList(sections, row.keyIndent + 4, eol),
    ].join(eol);
    return applyEdits(text, insertBlock(text, row.anchorEnd, block, eol));
  }
  if (list === null) {
    // The row has a config but lists nothing yet: add the key to that mapping.
    const pad = " ".repeat(row.configIndent);
    const block = [
      `${pad}${SECTIONS_CONFIG_KEY}:`,
      renderSectionsList(sections, row.configIndent + 2, eol),
    ].join(eol);
    return applyEdits(text, insertBlock(text, row.anchorEnd, block, eol));
  }
  const [rawStart, valueEnd] = rangeOf(list, "sections list");
  // A block sequence's range opens at its first `-`, so the indentation of that
  // line sits outside the region: replacing from the dash alone would stack our
  // own indent on top of the file's. A scalar value's range opens after its
  // `key: `, where the text before it is not blank, so this only moves a region
  // that starts a line.
  const lineStart = lineStartAt(text, rawStart);
  const valueStart = /^[ \t]*$/u.test(text.slice(lineStart, rawStart))
    ? lineStart
    : rawStart;
  const rendered = renderSectionsList(sections, row.configIndent + 2, eol);
  return applyEdits(text, [
    {
      start: valueStart,
      end: valueEnd,
      text: matchLineTerminator(text, rendered, valueStart, valueEnd, eol),
    },
  ]);
}
