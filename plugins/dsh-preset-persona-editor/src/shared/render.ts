/**
 * Rendering of persona values back into composition YAML.
 *
 * One renderer serves both halves: the host writer splices these strings into
 * the composition file, and the browser preview shows the very same text, so
 * what the preview claims is what the save produces.
 *
 * Node-free on purpose (browser-safe). The rendering is deliberately narrow —
 * the four managed keys of one persona row — and never round-trips the whole
 * document through a YAML emitter, which would rewrite the `!!js` expressions,
 * block scalars, comments, and spacing a preset's composition is made of.
 * @module shared/render
 */

import { PERSONA_PLUGIN_NAME, PERSONA_ROW_ID } from "./persona.js";
import type { PersonaDraft } from "../types.js";

/** Multi-line values whose trailing newline matters are rare; we keep it. */
const NUMERIC = /^-?\d+(?:\.\d+)?$/u;
const RESERVED = new Set([
  "true",
  "false",
  "null",
  "~",
  "yes",
  "no",
  "on",
  "off",
]);

/**
 * Whether the value carries a character a plain scalar cannot hold. Written as
 * a scan rather than a character-class regex: the class is a control range, and
 * a control range spelled as a literal is both hard to read and easy to get
 * wrong by one code point.
 * @param value - the value to scan.
 * @returns true when a control character is present.
 */
function hasControlChars(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Whether a single-line value survives a plain (unquoted) YAML scalar.
 *
 * Conservative by design: anything questionable is double-quoted instead, so
 * the value always reads back as the same string. The patterns are YAML 1.2
 * core-schema shapes — the ones the harness's own loader would resolve
 * differently from a string.
 * @param value - the value as the user typed it.
 * @returns true when the value can be written bare.
 */
function plainSafe(value: string): boolean {
  if (value === "") return false;
  if (value !== value.trim()) return false;
  if (hasControlChars(value)) return false;
  // Indicators cannot open a plain scalar; `{`/`[` would start a flow node.
  if (/^[-?:,[\]{}#&*!|>'"%@`]/u.test(value)) return false;
  // `key: value` and trailing comments would split the scalar.
  if (value.includes(": ") || value.endsWith(":")) return false;
  if (value.includes(" #")) return false;
  // Values the loader would resolve as a boolean, null, or a number.
  if (RESERVED.has(value.toLowerCase()) || NUMERIC.test(value)) return false;
  return true;
}

/**
 * Render one string value as the text that follows `key: `.
 *
 * Multi-line values become a block literal (`|-`, or `|` when the value ends
 * with a newline); single-line values stay plain when that is unambiguous and
 * are double-quoted otherwise.
 * @param value - the value to render.
 * @param indent - column the key starts at; block content is indented past it.
 * @param eol - line ending to use inside a block scalar.
 * @returns the replacement text for the value's source range.
 */
export function renderScalar(
  value: string,
  indent: number,
  eol: string,
): string {
  if (!value.includes("\n")) {
    return plainSafe(value) ? value : JSON.stringify(value);
  }
  const keepsTrailingNewline = value.endsWith("\n");
  const body = keepsTrailingNewline ? value.slice(0, -1) : value;
  const pad = " ".repeat(indent + 2);
  const lines = body
    .split("\n")
    .map((line) => (line === "" ? "" : `${pad}${line}`));
  return [`${keepsTrailingNewline ? "|" : "|-"}`, ...lines].join(eol);
}

/**
 * Render the four managed keys as a config block body (no `config:` line).
 * @param draft - values to render.
 * @param indent - column the keys start at.
 * @param eol - line ending to use.
 * @returns block mapping text, each line terminated by `eol`.
 */
export function renderConfigBlock(
  draft: PersonaDraft,
  indent: number,
  eol: string,
): string {
  const pad = " ".repeat(indent);
  const lines = [
    `${pad}prefix: ${renderScalar(draft.prefix, indent, eol)}`,
    `${pad}suffix: ${renderScalar(draft.suffix, indent, eol)}`,
    `${pad}complete: ${draft.complete ? "true" : "false"}`,
    `${pad}includeRuntimeContext: ${draft.includeRuntimeContext ? "true" : "false"}`,
  ];
  return lines.join(eol) + eol;
}

/**
 * Render a whole persona row for a composition that has none yet.
 * @param draft - values to render.
 * @param rowIndent - column the `-` indicator starts at.
 * @param eol - line ending to use.
 * @returns the row text, terminated by `eol`.
 */
export function renderPersonaRow(
  draft: PersonaDraft,
  rowIndent: number,
  eol: string,
): string {
  const pad = " ".repeat(rowIndent);
  const keyIndent = rowIndent + 2;
  const head = [
    `${pad}- id: ${PERSONA_ROW_ID}`,
    `${" ".repeat(keyIndent)}name: '${PERSONA_PLUGIN_NAME}'`,
  ].join(eol);
  return `${head}${eol}${" ".repeat(keyIndent)}config:${eol}${renderConfigBlock(draft, keyIndent + 2, eol)}`;
}

/**
 * The line ending a document already uses, so inserted lines match the file
 * instead of mixing conventions on a Windows checkout.
 * @param text - document text.
 * @returns `\r\n` when the document is predominantly CRLF, else `\n`.
 */
export function detectEol(text: string): string {
  let crlf = 0;
  let lf = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      if (text[index - 1] === "\r") crlf += 1;
      else lf += 1;
    }
  }
  return crlf > lf ? "\r\n" : "\n";
}

/** Split a byte-order mark off a document. */
export interface BomSplit {
  /** Whether the document began with a U+FEFF. */
  readonly bom: boolean;
  /** The document without the mark; the parser sees this. */
  readonly text: string;
}

/**
 * Split off a leading byte-order mark. The mark is not content, but dropping
 * it on write would rewrite a byte the user's editor put there.
 * @param raw - document text as read.
 * @returns the mark's presence and the marked text.
 */
export function splitBom(raw: string): BomSplit {
  return raw.charCodeAt(0) === 0xfeff
    ? { bom: true, text: raw.slice(1) }
    : { bom: false, text: raw };
}

/** Put a split-off byte-order mark back in front of a document. */
export function joinBom(split: BomSplit, text: string): string {
  return split.bom ? `\uFEFF${text}` : text;
}
