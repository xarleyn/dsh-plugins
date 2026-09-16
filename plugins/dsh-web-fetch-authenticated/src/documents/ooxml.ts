/**
 * Office-document text extraction: the one XML part a Word or OpenDocument
 * file keeps its body in, turned into Markdown. No external binary and no
 * temporary file is involved — the document is inflated in memory and scanned
 * as a tag stream.
 *
 * The scan keeps exactly what a reader needs to follow the text: paragraph
 * boundaries, heading levels, list items, table rows, and cell text. Field
 * codes, deleted revisions, comments, drawings, and footnotes are dropped —
 * they are either not the document's text or would interleave it with markup
 * that has no Markdown form. What comes out is the document's words, not its
 * layout: styles, colours, images, and headers/footers are not represented.
 * @module documents/ooxml
 */

import { readEntryBytes, readZipEntries } from "./zip.js";

/** Media types whose text this module can read. */
export const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOCX_MACRO_MEDIA_TYPE =
  "application/vnd.ms-word.document.macroEnabled.12";
export const DOCX_TEMPLATE_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template";
export const ODT_MEDIA_TYPE = "application/vnd.oasis.opendocument.text";

export type OfficeFormat = "docx" | "odt";

/** Zip part holding the document body, per format. */
const BODY_PART: Readonly<Record<OfficeFormat, string>> = Object.freeze({
  docx: "word/document.xml",
  odt: "content.xml",
});

interface Dialect {
  /** Element that wraps one paragraph of text. */
  readonly paragraph: string;
  /** Element that IS a heading (ODF); its level comes from `headingLevelAttr`. */
  readonly headingElement?: string;
  /** Attribute carrying the heading level: `w:val` (style id) or ODF's outline level. */
  readonly headingLevelAttr: string;
  /** Style element (DOCX) whose value marks a paragraph as a heading. */
  readonly headingStyleElement?: string;
  readonly headingStylePrefixes: readonly string[];
  readonly table: string;
  readonly row: string;
  readonly cell: string;
  /** Elements whose text content is the document text (DOCX `w:t`). */
  readonly textElements: ReadonlySet<string>;
  /** Whether any text node inside a paragraph counts (ODF puts text there directly). */
  readonly acceptsAnyText: boolean;
  readonly tab: string;
  readonly lineBreak: string;
  /** Element that stands for literal spaces (ODF `text:s`). */
  readonly spaceElement?: string;
  /** Element whose presence marks the surrounding/next paragraph as a list item. */
  readonly listMarker: string;
  /** Subtrees that never contribute text. */
  readonly skip: ReadonlySet<string>;
}

const DOCX_DIALECT: Dialect = {
  paragraph: "w:p",
  headingLevelAttr: "w:val",
  headingStyleElement: "w:pStyle",
  headingStylePrefixes: ["Heading", "heading", "Заголовок", "заголовок"],
  table: "w:tbl",
  row: "w:tr",
  cell: "w:tc",
  textElements: new Set(["w:t"]),
  acceptsAnyText: false,
  tab: "w:tab",
  lineBreak: "w:br",
  listMarker: "w:numPr",
  skip: new Set([
    "w:instrText",
    "w:del",
    "w:delText",
    "w:commentRangeStart",
    "w:commentRangeEnd",
    "w:commentReference",
    "w:footnoteReference",
    "w:endnoteReference",
    "w:drawing",
    "w:pict",
    "w:object",
    "w:bookmarkStart",
    "w:bookmarkEnd",
  ]),
};

const ODT_DIALECT: Dialect = {
  paragraph: "text:p",
  headingElement: "text:h",
  headingLevelAttr: "text:outline-level",
  headingStylePrefixes: [],
  table: "table:table",
  row: "table:table-row",
  cell: "table:table-cell",
  textElements: new Set(),
  acceptsAnyText: true,
  tab: "text:tab",
  lineBreak: "text:line-break",
  spaceElement: "text:s",
  listMarker: "text:list-item",
  skip: new Set([
    "office:annotation",
    "text:note",
    "text:note-body",
    "draw:frame",
    "draw:image",
    "text:tracked-changes",
    "text:soft-page-break",
    "office:forms",
    "table:table-column",
  ]),
};

export interface ExtractTextLimits {
  /** Cap on one inflated document part. */
  readonly maxPartBytes: number;
  /** Cap on the produced Markdown. */
  readonly maxChars: number;
}

export interface ExtractedDocumentText {
  readonly format: OfficeFormat;
  readonly markdown: string;
  readonly truncated: boolean;
}

/**
 * Extract a document's body text as Markdown. `format` is only a hint: the
 * archive decides, so a mislabelled content type still extracts the right part
 * when the bytes hold one of the known bodies. `undefined` means "not an office
 * document this module can read".
 */
export function extractOfficeText(
  bytes: Uint8Array,
  limits: ExtractTextLimits,
  format?: OfficeFormat,
): ExtractedDocumentText | undefined {
  const entries = readZipEntries(bytes);
  if (entries.length === 0) return undefined;
  const candidates: readonly OfficeFormat[] =
    format === undefined ? ["docx", "odt"] : [format];
  for (const candidate of candidates) {
    const part = entries.find((entry) => entry.name === BODY_PART[candidate]);
    if (part === undefined) continue;
    const xml = readEntryBytes(bytes, part, limits.maxPartBytes);
    if (xml === undefined) continue;
    const dialect = candidate === "docx" ? DOCX_DIALECT : ODT_DIALECT;
    const text = renderDocument(decodeXml(xml), dialect);
    const truncated = text.length > limits.maxChars;
    return {
      format: candidate,
      markdown: truncated ? text.slice(0, limits.maxChars) : text,
      truncated,
    };
  }
  return undefined;
}

/** Whether a buffer looks like a ZIP archive (the container of both formats). */
export function isZipArchive(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

function decodeXml(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

interface ScanEvent {
  readonly kind: "start" | "end" | "self" | "text";
  readonly name: string;
  readonly attrs: string;
  readonly text: string;
}

/** Split XML into tags and text runs; enough structure for the two dialects. */
function* scan(xml: string): Generator<ScanEvent> {
  const tokenPattern = /<[^>]*>|[^<]+/gu;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(xml)) !== null) {
    const token = match[0];
    if (!token.startsWith("<")) {
      yield { kind: "text", name: "", attrs: "", text: decodeEntities(token) };
      continue;
    }
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      yield {
        kind: "end",
        name: leadingName(token.slice(2, -1)),
        attrs: "",
        text: "",
      };
      continue;
    }
    const selfClosing = token.endsWith("/>");
    const inner = token.slice(1, selfClosing ? -2 : -1);
    const name = leadingName(inner);
    yield {
      kind: selfClosing ? "self" : "start",
      name,
      attrs: inner.slice(name.length),
      text: "",
    };
  }
}

function leadingName(inner: string): string {
  const end = inner.search(/[\s/]/u);
  return end === -1 ? inner : inner.slice(0, end);
}

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/gu,
    (
      whole: string,
      decimal: string | undefined,
      hex: string | undefined,
      name: string | undefined,
    ) => {
      if (decimal !== undefined) return safeCodePoint(Number(decimal), whole);
      if (hex !== undefined) return safeCodePoint(parseInt(hex, 16), whole);
      switch (name) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default:
          return whole;
      }
    },
  );
}

function safeCodePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

function attrValue(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, "u");
  const value = pattern.exec(attrs)?.[1];
  return value === undefined ? undefined : decodeEntities(value);
}

interface TableState {
  rows: string[][];
  row: string[];
  cell: string[];
}

interface ParagraphState {
  parts: string[];
  heading?: number;
  list: boolean;
}

/** Render one document body XML into Markdown. */
function renderDocument(xml: string, dialect: Dialect): string {
  const blocks: string[] = [];
  let paragraph: ParagraphState | undefined;
  let table: TableState | undefined;
  let skipDepth = 0;
  let textDepth = 0;
  let listPending = false;

  const flushParagraph = (): void => {
    const current = paragraph;
    if (current === undefined) return;
    paragraph = undefined;
    const text = collapse(current.parts.join(""));
    if (text.length === 0) return;
    if (table !== undefined) {
      table.cell.push(text);
      return;
    }
    if (current.heading !== undefined)
      blocks.push(
        `${"#".repeat(Math.min(6, Math.max(1, current.heading)))} ${text}`,
      );
    else if (current.list) blocks.push(`- ${text}`);
    else blocks.push(text);
  };

  for (const event of scan(xml)) {
    if (event.name !== "" && dialect.skip.has(event.name)) {
      if (event.kind === "start") skipDepth += 1;
      else if (event.kind === "end" && skipDepth > 0) skipDepth -= 1;
      continue;
    }
    if (skipDepth > 0) continue;

    if (event.kind === "text") {
      const relevant = dialect.acceptsAnyText
        ? paragraph !== undefined
        : textDepth > 0;
      if (relevant) paragraph?.parts.push(event.text);
      continue;
    }

    if (event.kind === "self") {
      if (dialect.spaceElement === event.name) {
        const count = Number.parseInt(
          attrValue(event.attrs, "text:c") ?? "1",
          10,
        );
        paragraph?.parts.push(
          " ".repeat(
            Number.isFinite(count) && count > 0 ? Math.min(count, 64) : 1,
          ),
        );
      } else if (event.name === dialect.tab) paragraph?.parts.push("\t");
      else if (event.name === dialect.lineBreak) paragraph?.parts.push("\n");
      else if (dialect.listMarker === event.name) markList();
      else if (
        dialect.headingStyleElement !== undefined &&
        event.name === dialect.headingStyleElement &&
        paragraph !== undefined
      ) {
        const style = attrValue(event.attrs, dialect.headingLevelAttr) ?? "";
        const level = headingLevelOf(style, dialect.headingStylePrefixes);
        if (level !== undefined) paragraph.heading = level;
      }
      continue;
    }

    if (
      event.name === dialect.paragraph ||
      event.name === dialect.headingElement
    ) {
      if (event.kind === "start") {
        const level =
          event.name === dialect.headingElement
            ? headingLevelOf(
                attrValue(event.attrs, dialect.headingLevelAttr) ?? "",
                [],
              )
            : undefined;
        paragraph = {
          parts: [],
          list: listPending,
          ...(level === undefined ? {} : { heading: level }),
        };
        listPending = false;
      } else {
        flushParagraph();
      }
      continue;
    }

    if (event.name === dialect.table) {
      if (event.kind === "start") table = { rows: [], row: [], cell: [] };
      else {
        flushParagraph();
        const rendered = table === undefined ? "" : renderTable(table.rows);
        if (rendered.length > 0) blocks.push(rendered);
        table = undefined;
      }
      continue;
    }

    if (event.name === dialect.row) {
      if (event.kind === "start") {
        flushParagraph();
        if (table !== undefined) table.row = [];
      } else if (table !== undefined) {
        flushParagraph();
        table.rows.push(table.row);
        table.row = [];
      }
      continue;
    }

    if (event.name === dialect.cell) {
      if (event.kind === "start") {
        flushParagraph();
        if (table !== undefined) table.cell = [];
      } else if (table !== undefined) {
        flushParagraph();
        table.row.push(collapse(table.cell.join(" ")));
        table.cell = [];
      }
      continue;
    }

    if (dialect.textElements.has(event.name)) {
      if (event.kind === "start") textDepth += 1;
      else if (textDepth > 0) textDepth -= 1;
      continue;
    }

    if (event.kind === "start" && event.name === dialect.listMarker) markList();
  }

  function markList(): void {
    if (paragraph === undefined) listPending = true;
    else paragraph.list = true;
  }

  return normalizeBlocks(blocks);
}

/** Collapse whitespace the way a reader would: newlines and tabs become spaces. */
function collapse(text: string): string {
  return text
    .replace(/\u00a0/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** `Heading1` / `Заголовок 2` / ODF's outline level → heading level. */
function headingLevelOf(
  style: string,
  prefixes: readonly string[],
): number | undefined {
  const trimmed = style.trim();
  if (trimmed.length === 0) return undefined;
  for (const prefix of prefixes) {
    if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const digits = trimmed.slice(prefix.length).replace(/[\s_-]/gu, "");
    const level = Number.parseInt(digits, 10);
    if (Number.isFinite(level) && level >= 1) return level;
  }
  if (prefixes.length === 0) {
    const level = Number.parseInt(trimmed, 10);
    if (Number.isFinite(level) && level >= 1) return level;
  }
  return undefined;
}

function renderTable(rows: readonly string[][]): string {
  const filled = rows.filter((row) => row.some((cell) => cell.length > 0));
  if (filled.length === 0) return "";
  const width = Math.max(...filled.map((row) => row.length), 1);
  const line = (cells: readonly string[]): string =>
    `| ${Array.from({ length: width }, (_, index) => (cells[index] ?? "").replace(/\|/gu, "\\|")).join(" | ")} |`;
  const out = [
    line(filled[0] ?? []),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
  ];
  for (const row of filled.slice(1)) out.push(line(row));
  return out.join("\n");
}

function normalizeBlocks(blocks: readonly string[]): string {
  return blocks
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .join("\n\n")
    .trim();
}
