/**
 * Native DOCX extraction (§11, §12, §27).
 *
 * A DOCX is a ZIP of XML, and for a contract comparison that is the best news
 * in the pipeline: the package states its own paragraph boundaries, table grid,
 * numbering, headers, footnotes and tracked revisions, so the diff runs on what
 * Word wrote instead of on what a converter made of it. Routing
 * `DOCX → Docling → Markdown → diff` would put a renderer between the two
 * revisions and let its line wrapping and table flattening become the answer.
 *
 * What this extractor deliberately does not do:
 *
 * - it never follows a relationship, so an `external` image or hyperlink target
 *   stays a name in an XML file — no socket is opened during a comparison;
 * - it never executes anything: macros are refused before extraction and the
 *   VBA part is never read;
 * - it never merges tracked revisions into the text. Insertions count as text
 *   (that is what Word shows), deletions are recorded as revisions and left out
 *   of it, and the comparison says plainly that revisions were present.
 */

import {
  CanonicalNodeCollector,
  parseFailure,
  type NodeDraft,
  type StructuredDocumentExtractor,
  type StructuredExtractionInput,
} from "./extractor.js";
import type {
  CanonicalDocument,
  DocumentPart,
  NodeRevision,
} from "../canonical/document-ir.js";
import {
  findZipEntry,
  readZipEntries,
  readZipEntry,
  type ZipEntry,
} from "../../inspect/zip.js";
import type { DocumentWarning } from "../../types.js";
import {
  attributeValue,
  descendantsNamed,
  firstChildNamed,
  parseXml,
  textContent,
  XmlParseError,
  type XmlElement,
} from "../ooxml/xml.js";

/**
 * Elements that only wrap other elements. The walk descends through them, so a
 * table inside a content control is still a table, and a paragraph split by
 * tracked-change markers is still one paragraph.
 */
const TRANSPARENT = new Set([
  "sdt",
  "sdtContent",
  "customXml",
  "smartTag",
  "ins",
  "del",
  "moveFrom",
  "moveTo",
]);

export class DocxStructuredExtractor implements StructuredDocumentExtractor {
  readonly name = "native-docx";

  supports(filename: string): boolean {
    return /\.docx$/iu.test(filename);
  }

  async extract(input: StructuredExtractionInput): Promise<CanonicalDocument> {
    return extractDocx(input);
  }
}

export function extractDocx(
  input: StructuredExtractionInput,
): CanonicalDocument {
  const entries = readZipEntries(input.bytes);
  if (entries === undefined) {
    throw parseFailure("the file is not a readable OOXML package");
  }
  const reader = new PackageReader(
    input.bytes,
    entries,
    input.maxUncompressedBytes,
  );
  const collector = new CanonicalNodeCollector({ maxNodes: input.maxNodes });
  const state: WalkState = {
    collector,
    ignoreFormatting: input.ignoreFormatting,
    revisionCount: 0,
  };

  const documentPart = reader.read("word/document.xml");
  if (documentPart === undefined) {
    throw parseFailure("the package has no word/document.xml part");
  }
  const styles = readStyles(reader.read("word/styles.xml"));
  const body = descendantsNamed(parsePart(documentPart), "body")[0];
  if (body === undefined) {
    throw parseFailure("word/document.xml has no document body");
  }
  walkContainer(body, state, styles, "body", "word/document.xml");

  for (const name of reader.partsMatching(/^word\/header\d*\.xml$/u)) {
    walkPart(reader, name, state, styles, "header");
  }
  for (const name of reader.partsMatching(/^word\/footer\d*\.xml$/u)) {
    walkPart(reader, name, state, styles, "footer");
  }
  readFootnotes(reader, state);
  readComments(reader, state);

  const warnings: DocumentWarning[] = [];
  if (state.revisionCount > 0) {
    warnings.push({
      code: "TRACK_CHANGES_PRESENT",
      message: `${state.revisionCount} tracked revisions were found; insertions count as text and deletions are reported as revisions`,
      details: { revisions: state.revisionCount },
    });
  }
  return collector.build("native-docx", "native-docx", { warnings });
}

interface WalkState {
  readonly collector: CanonicalNodeCollector;
  readonly ignoreFormatting: boolean;
  revisionCount: number;
}

interface HeadingStyles {
  readonly byStyleId: ReadonlyMap<string, number>;
}

/* ------------------------------------------------------------------ parts */

class PackageReader {
  private used = 0;

  constructor(
    private readonly buffer: Buffer,
    private readonly entries: readonly ZipEntry[],
    private readonly maxUncompressedBytes: number,
  ) {}

  read(name: string): string | undefined {
    const entry = findZipEntry(this.entries, name);
    if (entry === undefined) return undefined;
    const payload = readZipEntry(this.buffer, entry);
    if (payload === undefined) return undefined;
    this.used += payload.length;
    if (this.used > this.maxUncompressedBytes) {
      throw parseFailure(
        "the document's XML parts exceed the configured uncompressed size budget",
        { maxUncompressedBytes: this.maxUncompressedBytes },
      );
    }
    return payload.toString("utf8");
  }

  /** Part names matching a pattern, sorted, so the walk order never varies. */
  partsMatching(pattern: RegExp): string[] {
    return this.entries
      .map((entry) => entry.name)
      .filter((name) => pattern.test(name))
      .sort();
  }
}

function parsePart(part: string): XmlElement {
  try {
    return parseXml(part);
  } catch (error) {
    if (error instanceof XmlParseError) {
      throw parseFailure(`the document XML is malformed: ${error.message}`, {
        offset: error.offset,
      });
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ styles */

function readStyles(stylesXml: string | undefined): HeadingStyles {
  const byStyleId = new Map<string, number>();
  if (stylesXml === undefined) return { byStyleId };
  for (const style of descendantsNamed(parsePart(stylesXml), "style")) {
    const styleId = attributeValue(style, "styleId");
    if (styleId === undefined) continue;
    const level = headingLevelOfStyle(style);
    if (level !== undefined) byStyleId.set(styleId, level);
  }
  return { byStyleId };
}

function headingLevelOfStyle(style: XmlElement): number | undefined {
  const properties = firstChildNamed(style, "pPr");
  const outline =
    properties === undefined
      ? undefined
      : firstChildNamed(properties, "outlineLvl");
  const outlineValue =
    outline === undefined ? undefined : attributeValue(outline, "val");
  const parsedOutline =
    outlineValue === undefined ? undefined : Number.parseInt(outlineValue, 10);
  if (parsedOutline !== undefined && Number.isFinite(parsedOutline)) {
    return clampHeadingLevel(parsedOutline + 1);
  }
  // A style without an outline level may still be named like a heading, which
  // is how a document produced from a template usually looks.
  const name = firstChildNamed(style, "name");
  const nameValue =
    name === undefined ? undefined : attributeValue(name, "val");
  if (nameValue === undefined) return undefined;
  const match = /^(?:heading|заголовок)\s*(\d+)/iu.exec(nameValue.trim());
  return match === null
    ? undefined
    : clampHeadingLevel(Number.parseInt(match[1] as string, 10));
}

function clampHeadingLevel(level: number): number {
  return Math.min(6, Math.max(1, level));
}

/* -------------------------------------------------------------- body walk */

function walkPart(
  reader: PackageReader,
  name: string,
  state: WalkState,
  styles: HeadingStyles,
  part: DocumentPart,
): void {
  const raw = reader.read(name);
  if (raw === undefined) return;
  // A part's root is `w:hdr` / `w:ftr`, wrapped in the synthetic document node
  // the reader returns; walk the part element, not the wrapper.
  const container = firstElementChild(parsePart(raw)) ?? parsePart(raw);
  walkContainer(container, state, styles, part, name);
}

function firstElementChild(root: XmlElement): XmlElement | undefined {
  return root.children.find(
    (child): child is XmlElement => child.kind === "element",
  );
}

/**
 * Emit the nodes of a body-like container: the document body, a header part, a
 * footer part. `part` records where they came from; `type` records what they
 * are, so paragraphs in a header align with paragraphs in a header.
 */
function walkContainer(
  container: XmlElement,
  state: WalkState,
  styles: HeadingStyles,
  part: DocumentPart,
  xmlPath: string,
): void {
  let paragraphCounter = 0;
  let tableCounter = 0;
  for (const child of structuralChildren(container)) {
    if (child.name === "p") {
      const read = readParagraphText(child, state.ignoreFormatting);
      const text = read.text.trim();
      if (text === "" && read.revisions.length === 0) continue;
      paragraphCounter += 1;
      state.revisionCount += read.revisions.length;
      const level = headingLevelOf(child, styles);
      const listLevel = listLevelOf(child);
      const draft: NodeDraft = {
        type:
          level !== undefined
            ? "heading"
            : listLevel === undefined
              ? "paragraph"
              : "list-item",
        part,
        rawText: text,
        source: { paragraph: paragraphCounter, xmlPath },
        ...(level !== undefined ? { level } : {}),
        ...(listLevel === undefined ? {} : { level: listLevel }),
        ...(read.revisions.length === 0 ? {} : { revisions: read.revisions }),
        ...(read.formatting === "" ? {} : { formatting: read.formatting }),
      };
      state.collector.add(draft);
      continue;
    }
    if (child.name === "tbl") {
      tableCounter += 1;
      const rows = readTable(child, state, tableCounter, xmlPath);
      if (rows.length === 0) continue;
      paragraphCounter += 1;
      state.collector.add({
        type: "table",
        part,
        rawText: rows.map((row) => row.rawText).join("\n"),
        source: { paragraph: paragraphCounter, table: tableCounter, xmlPath },
        table: { rows },
      });
    }
  }
}

/** Element children, descending through wrappers that carry no structure. */
function* structuralChildren(container: XmlElement): Generator<XmlElement> {
  for (const child of container.children) {
    if (child.kind !== "element") continue;
    if (TRANSPARENT.has(child.name)) {
      yield* structuralChildren(child);
      continue;
    }
    yield child;
  }
}

/** Children with a matching name, descending through wrapper elements. */
function structuralChildrenOf(
  container: XmlElement,
  name: string,
): XmlElement[] {
  const found: XmlElement[] = [];
  for (const child of structuralChildren(container)) {
    if (child.name === name) found.push(child);
  }
  return found;
}

/* -------------------------------------------------------------- paragraph */

interface ParagraphText {
  readonly text: string;
  readonly revisions: readonly NodeRevision[];
  readonly formatting: string;
}

function readParagraphText(
  paragraph: XmlElement,
  ignoreFormatting: boolean,
): ParagraphText {
  const revisions: NodeRevision[] = [];
  const formatting: string[] = [];
  let text = "";
  const visit = (element: XmlElement): void => {
    const name = element.name;
    if (name === "del") {
      // Deleted text belongs to the revision, not to the paragraph: both sides
      // of a comparison then read the way Word renders the document.
      const deleted = descendantsNamed(element, "delText")
        .map((node) => textContent(node))
        .join("");
      revisions.push({
        type: "delete",
        ...revisionContext(element),
        ...(deleted === "" ? {} : { text: deleted }),
      });
      return;
    }
    if (name === "ins") {
      const inserted = descendantsNamed(element, "t")
        .map((node) => textContent(node))
        .join("");
      revisions.push({
        type: "insert",
        ...revisionContext(element),
        ...(inserted === "" ? {} : { text: inserted }),
      });
      descend(element, visit);
      return;
    }
    if (name === "t") {
      text += textContent(element);
      return;
    }
    if (name === "rPr" || name === "pPr") {
      if (!ignoreFormatting) {
        for (const child of element.children) {
          if (child.kind !== "element") continue;
          if (
            child.name === "pStyle" ||
            child.name === "numPr" ||
            child.name === "outlineLvl"
          ) {
            continue;
          }
          formatting.push(child.name);
        }
      }
      return;
    }
    if (name === "tab") {
      text += " ";
      return;
    }
    if (name === "br" || name === "cr") {
      text += "\n";
      return;
    }
    if (name === "noBreakHyphen") {
      text += "-";
      return;
    }
    if (
      name === "delText" ||
      name === "instrText" ||
      name === "softHyphen" ||
      name === "drawing" ||
      name === "pict" ||
      name === "object" ||
      name === "sym" ||
      name === "proofErr" ||
      name === "bookmarkStart" ||
      name === "bookmarkEnd" ||
      name === "commentRangeStart" ||
      name === "commentRangeEnd" ||
      name === "commentReference" ||
      name === "footnoteReference" ||
      name === "endnoteReference" ||
      name === "lastRenderedPageBreak"
    ) {
      return;
    }
    descend(element, visit);
  };
  descend(paragraph, visit);
  return {
    text: text.replace(/[ \t]+$/gu, ""),
    revisions,
    formatting: [...new Set(formatting)].sort().join(","),
  };
}

function descend(
  element: XmlElement,
  visit: (child: XmlElement) => void,
): void {
  for (const child of element.children) {
    if (child.kind === "element") visit(child);
  }
}

function revisionContext(element: XmlElement): {
  readonly author?: string;
  readonly date?: string;
} {
  const author = attributeValue(element, "author");
  const date = attributeValue(element, "date");
  return {
    ...(author === undefined || author === "" ? {} : { author }),
    ...(date === undefined || date === "" ? {} : { date }),
  };
}

function headingLevelOf(
  paragraph: XmlElement,
  styles: HeadingStyles,
): number | undefined {
  const properties = firstChildNamed(paragraph, "pPr");
  if (properties === undefined) return undefined;
  const outline = firstChildNamed(properties, "outlineLvl");
  const outlineValue =
    outline === undefined ? undefined : attributeValue(outline, "val");
  const parsedOutline =
    outlineValue === undefined ? undefined : Number.parseInt(outlineValue, 10);
  if (parsedOutline !== undefined && Number.isFinite(parsedOutline)) {
    return clampHeadingLevel(parsedOutline + 1);
  }
  const style = firstChildNamed(properties, "pStyle");
  const styleId =
    style === undefined ? undefined : attributeValue(style, "val");
  if (styleId === undefined) return undefined;
  const fromStyles = styles.byStyleId.get(styleId);
  if (fromStyles !== undefined) return fromStyles;
  const match = /^(?:heading|заголовок)\s*(\d+)/iu.exec(styleId.trim());
  return match === null
    ? undefined
    : clampHeadingLevel(Number.parseInt(match[1] as string, 10));
}

/** List nesting level: `w:numPr` present with a real numbering reference. */
function listLevelOf(paragraph: XmlElement): number | undefined {
  const properties = firstChildNamed(paragraph, "pPr");
  if (properties === undefined) return undefined;
  const numbering = firstChildNamed(properties, "numPr");
  if (numbering === undefined) return undefined;
  const numId = firstChildNamed(numbering, "numId");
  const value = numId === undefined ? undefined : attributeValue(numId, "val");
  if (value === undefined || value === "0") return undefined;
  const level = firstChildNamed(numbering, "ilvl");
  const raw = level === undefined ? undefined : attributeValue(level, "val");
  const parsed = raw === undefined ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.min(9, Math.max(0, parsed)) + 1 : 1;
}

/* ----------------------------------------------------------------- tables */

interface TableDraft {
  readonly rows: readonly {
    readonly row: number;
    readonly cells: readonly {
      readonly column: number;
      readonly rawText: string;
      readonly source: {
        readonly table: number;
        readonly row: number;
        readonly column: number;
        readonly xmlPath: string;
      };
    }[];
    readonly rawText: string;
  }[];
}

function readTable(
  table: XmlElement,
  state: WalkState,
  tableNumber: number,
  xmlPath: string,
): TableDraft["rows"] {
  const rows: {
    row: number;
    cells: {
      column: number;
      rawText: string;
      source: {
        table: number;
        row: number;
        column: number;
        xmlPath: string;
      };
    }[];
    rawText: string;
  }[] = [];
  let rowIndex = 0;
  for (const row of structuralChildrenOf(table, "tr")) {
    const cells: (typeof rows)[number]["cells"] = [];
    let column = 0;
    for (const cell of structuralChildrenOf(row, "tc")) {
      cells.push({
        column,
        rawText: readCellText(cell, state.ignoreFormatting),
        source: { table: tableNumber, row: rowIndex, column, xmlPath },
      });
      column += gridSpanOf(cell);
    }
    rows.push({
      row: rowIndex,
      cells,
      rawText: cells.map((cell) => cell.rawText).join(" | "),
    });
    rowIndex += 1;
  }
  return rows;
}

function gridSpanOf(cell: XmlElement): number {
  const properties = firstChildNamed(cell, "tcPr");
  const span =
    properties === undefined
      ? undefined
      : firstChildNamed(properties, "gridSpan");
  const value = span === undefined ? undefined : attributeValue(span, "val");
  const parsed = value === undefined ? 1 : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(64, parsed) : 1;
}

/** A cell's text: its own paragraphs, joined; a nested table is not descended. */
function readCellText(cell: XmlElement, ignoreFormatting: boolean): string {
  const parts: string[] = [];
  for (const paragraph of structuralChildrenOf(cell, "p")) {
    const text = readParagraphText(paragraph, ignoreFormatting).text.trim();
    if (text !== "") parts.push(text);
  }
  return parts.join(" ");
}

/* ------------------------------------------------- footnotes and comments */

function readFootnotes(reader: PackageReader, state: WalkState): void {
  const raw = reader.read("word/footnotes.xml");
  if (raw === undefined) return;
  for (const note of descendantsNamed(parsePart(raw), "footnote")) {
    const type = attributeValue(note, "type");
    if (type === "separator" || type === "continuationSeparator") continue;
    addUnit(state, note, "footnote", "word/footnotes.xml");
  }
}

function readComments(reader: PackageReader, state: WalkState): void {
  const raw = reader.read("word/comments.xml");
  if (raw === undefined) return;
  for (const comment of descendantsNamed(parsePart(raw), "comment")) {
    addUnit(state, comment, "comment", "word/comments.xml");
  }
}

/** A footnote or a comment is a unit of its own: one node, its own text. */
function addUnit(
  state: WalkState,
  unit: XmlElement,
  part: "footnote" | "comment",
  xmlPath: string,
): void {
  const text = unitText(unit, state.ignoreFormatting);
  if (text === "") return;
  const id = attributeValue(unit, "id");
  const parsed = id === undefined ? undefined : Number.parseInt(id, 10);
  state.collector.add({
    type: part,
    part,
    rawText: text,
    source: {
      xmlPath,
      ...(parsed === undefined || !Number.isFinite(parsed)
        ? {}
        : { paragraph: parsed }),
    },
  });
}

function unitText(unit: XmlElement, ignoreFormatting: boolean): string {
  const parts: string[] = [];
  for (const paragraph of descendantsNamed(unit, "p")) {
    const text = readParagraphText(paragraph, ignoreFormatting).text.trim();
    if (text !== "") parts.push(text);
  }
  return parts.join(" ");
}
