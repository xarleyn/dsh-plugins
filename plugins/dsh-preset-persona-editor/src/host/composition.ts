/**
 * Surgical edits of one preset composition: read a persona row, rewrite the
 * four values it owns, insert the row when the preset has none, and remove the
 * row on reset.
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
  detectEol,
  renderConfigBlock,
  renderPersonaRow,
  renderScalar,
} from "../shared/render.js";
import type { PersonaDraft } from "../types.js";

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
 * wants: the expression is opaque here, and `readKeyValue` refuses to rewrite
 * any tagged scalar. Resolving them instead would hand this module a value it
 * must not touch as if it were a plain string.
 */

/** One key of a persona row's config, with the range a rewrite would replace. */
export interface PersonaConfigKey {
  readonly key: string;
  /** `string`/`boolean` for values this editor owns; `foreign` otherwise. */
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

/** One composition row that names the persona plugin. */
export interface PersonaRow {
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
  readonly keys: readonly PersonaConfigKey[];
  /** Config keys this editor does not own, in document order. */
  readonly unknownKeys: readonly string[];
  /** Owned keys whose value the editor must not rewrite, in document order. */
  readonly foreignKeys: readonly string[];
}

/** A parsed composition: the document tree plus the persona rows it names. */
export interface CompositionParse {
  readonly document: Document;
  /** Top-level persona rows, in composition order. */
  readonly rows: readonly PersonaRow[];
  /**
   * Persona rows anywhere in the document, including ones nested in groups.
   * A nested row means the persona is not this editor's to rewrite.
   */
  readonly deepRows: number;
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
function mapAnchorEnd(text: string, map: YAMLMap): number {
  const pairs = map.items as Pair[];
  const last = pairs[pairs.length - 1];
  if (last === undefined) return rangeOf(map, "composition row")[1];
  const value = last.value as Node | null;
  if (value !== null && value.range !== undefined)
    return rangeOf(value, "row value")[1];
  return rangeOf(last.key as Node, "row key")[1];
}

/** Read one value node into the editor's own key shape. */
function readKeyValue(
  key: string,
  value: Node | null,
  keyNode: Node,
): PersonaConfigKey {
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

/** Read one map's keys into {@link PersonaConfigKey}s. */
function readConfigKeys(map: YAMLMap): PersonaConfigKey[] {
  const keys: PersonaConfigKey[] = [];
  for (const pair of map.items as Pair[]) {
    const keyNode = pair.key;
    if (!isScalar(keyNode) || typeof keyNode.value !== "string") continue;
    keys.push(readKeyValue(keyNode.value, pair.value as Node | null, keyNode));
  }
  return keys;
}

/** Read a row node into {@link PersonaRow}, or undefined when it is not one. */
function readRow(text: string, node: Node): PersonaRow | undefined {
  if (!isMap(node)) return undefined;
  const namePair = node.items.find(
    (pair) => isScalar(pair.key) && pair.key.value === "name",
  );
  const nameValue = namePair?.value;
  if (!isScalar(nameValue) || nameValue.value !== PERSONA_PLUGIN_NAME) {
    return undefined;
  }
  const [start, end] = rangeOf(node, "persona row");
  const lineStart = lineStartAt(text, start);
  if (!/^[ \t]*-(\s|$)/u.test(text.slice(lineStart, start))) {
    throw new CompositionError(
      "persona row does not start a sequence item; the composition is not a plain block list",
    );
  }
  const nameKey = namePair?.key as Node;
  const nameKeyStart = rangeOf(nameKey, "persona row name")[0];
  const keyIndent = nameKeyStart - lineStartAt(text, nameKeyStart);
  const rowIndent = indentAt(text, start);
  const configPair = node.items.find(
    (pair) => isScalar(pair.key) && pair.key.value === "config",
  );
  const config = configPair?.value as Node | null | undefined;
  if (config !== undefined && config !== null && isMap(config)) {
    if (config.flow === true) {
      throw new CompositionError(
        "the persona row writes its config in flow style; this editor rewrites block mappings only",
      );
    }
    const keys = readConfigKeys(config);
    const owned = new Set<string>(PERSONA_MANAGED_KEYS);
    return {
      start,
      end,
      lineStart,
      rowIndent,
      keyIndent,
      anchorEnd: mapAnchorEnd(text, node),
      config,
      configIndent: indentAt(text, rangeOf(config, "persona config")[0]),
      keys,
      unknownKeys: keys
        .filter((entry) => !owned.has(entry.key))
        .map((entry) => entry.key),
      foreignKeys: keys
        .filter((entry) => owned.has(entry.key) && entry.kind === "foreign")
        .map((entry) => entry.key),
    };
  }
  return {
    start,
    end,
    lineStart,
    rowIndent,
    keyIndent,
    anchorEnd: mapAnchorEnd(text, node),
    config: undefined,
    configIndent: keyIndent + 2,
    keys: [],
    unknownKeys: [],
    foreignKeys: [],
  };
}

/** Count persona rows at any depth, so a nested row is never mistaken for none. */
function countDeepRows(node: Node | null): number {
  if (node === null) return 0;
  if (isMap(node)) {
    const isPersona = node.items.some(
      (pair) =>
        isScalar(pair.key) &&
        pair.key.value === "name" &&
        isScalar(pair.value) &&
        pair.value.value === PERSONA_PLUGIN_NAME,
    );
    let count = isPersona ? 1 : 0;
    for (const pair of node.items) {
      count += countDeepRows(pair.value as Node | null);
    }
    return count;
  }
  if (isSeq(node)) {
    let count = 0;
    for (const item of node.items) count += countDeepRows(item as Node | null);
    return count;
  }
  return 0;
}

/**
 * Parse a composition into positions.
 * @param text - the composition file's text, byte-order mark already split off.
 * @returns the document and the persona rows it names.
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
    return { document, rows: [], deepRows: 0 };
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
  const rows: PersonaRow[] = [];
  for (const item of (contents as YAMLSeq).items) {
    const node = item as Node | null;
    if (node === null || node.range === undefined) continue;
    const row = readRow(text, node);
    if (row !== undefined) rows.push(row);
  }
  return { document, rows, deepRows: countDeepRows(contents) };
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

/** The managed values one persona row carries. */
export interface PersonaRowValues {
  readonly draft: PersonaDraft;
  /** Config keys the row carries that this editor does not own. */
  readonly unknownKeys: readonly string[];
  /** Owned keys whose value is not a plain scalar. */
  readonly foreignKeys: readonly string[];
}

/**
 * Read the persona values out of a parsed composition.
 * @param rows - the top-level persona rows of a parse.
 * @returns the row's values (defaults when there is no row) and its unmanaged
 * and unrewritable keys.
 */
export function readPersonaValues(
  rows: readonly PersonaRow[],
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
    unknownKeys: row.unknownKeys,
    foreignKeys: row.foreignKeys,
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
  if (parse.deepRows > parse.rows.length) {
    throw new CompositionError(
      "another @deepseek-ai/dsh-persona row is nested inside a group; edit the composition file directly",
    );
  }
  if (parse.rows.length > 1) {
    throw new CompositionError(
      "the composition names more than one @deepseek-ai/dsh-persona row; edit the composition file directly",
    );
  }
  const eol = detectEol(text);
  const row = parse.rows[0];
  if (row === undefined) return appendRow(text, draft, eol);
  if (row.foreignKeys.length > 0) {
    throw new CompositionError(
      `the persona row's ${row.foreignKeys.join(", ")} is not a plain value; edit the composition file directly`,
    );
  }
  return rewriteRow(text, draft, row, eol);
}

/** Append a fresh persona row to a composition that has none. */
function appendRow(text: string, draft: PersonaDraft, eol: string): string {
  const row = renderPersonaRow(draft, 0, eol);
  if (text === "") return row;
  const body = text.endsWith("\n") ? text : `${text}${eol}`;
  // One blank line separates the new row from the composition's tail, matching
  // how a hand-written composition spaces its rows.
  const gap = body.endsWith(`${eol}${eol}`) ? "" : eol;
  return `${body}${gap}${row}`;
}

/** Rewrite the managed values of an existing row, keeping every other byte. */
function rewriteRow(
  text: string,
  draft: PersonaDraft,
  row: PersonaRow,
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
  if (parse.deepRows > parse.rows.length) {
    throw new CompositionError(
      "another @deepseek-ai/dsh-persona row is nested inside a group; edit the composition file directly",
    );
  }
  if (parse.rows.length > 1) {
    throw new CompositionError(
      "the composition names more than one @deepseek-ai/dsh-persona row; edit the composition file directly",
    );
  }
  const row = parse.rows[0];
  if (row === undefined) return text;
  const eol = detectEol(text);
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
