import ExcelJS from "exceljs";
import JSZip from "jszip";
import { parseXml, type XmlElement } from "../comparison/ooxml/xml.js";
import { readZipEntries, readZipEntry } from "../inspect/zip.js";
import { DocumentError } from "../errors.js";
import {
  checkSignal,
  invalid,
  positiveInteger,
  SPREADSHEET_LIMITS as limits,
  tooLarge,
} from "./guards.js";

export const ODS_MEDIA_TYPE = "application/vnd.oasis.opendocument.spreadsheet";
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"';
const WARNING =
  "OpenDocument extraction preserves table data, merged cells and OpenFormula expressions with saved results; visual styles, charts and layout are not preserved. Formulas are not calculated.";
const children = (node: XmlElement) =>
  node.children.filter(
    (child): child is XmlElement => child.kind === "element",
  );
function attr(node: XmlElement, name: string): string | undefined {
  for (const [key, value] of node.attributes)
    if (key.split(":").at(-1) === name) return value;
  return undefined;
}
function descendants(node: XmlElement, name: string): XmlElement[] {
  const result: XmlElement[] = [];
  const queue = [node];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (next.name === name) result.push(next);
    queue.push(...children(next).reverse());
  }
  return result;
}
function repetition(node: XmlElement, name: string): number {
  const value = attr(node, name);
  if (value === undefined) return 1;
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value)))
    invalid("Invalid OpenDocument repetition count");
  return Number(value);
}
function textOf(node: XmlElement): string {
  let text = "";
  for (const item of node.children) {
    if (item.kind === "text") text += item.value;
    else if (item.name === "s")
      text += " ".repeat(
        positiveInteger(
          Number(attr(item, "c") ?? 1),
          1,
          limits.cellChars,
          "Space count",
        ),
      );
    else if (item.name === "tab") text += "\t";
    else if (item.name === "line-break") text += "\n";
    else text += textOf(item);
    if (text.length > limits.cellChars)
      tooLarge("OpenDocument cell text exceeds the character limit");
  }
  return text;
}
function paragraphs(node: XmlElement): string {
  const value = descendants(node, "p").map(textOf).join("\n");
  if (value.length > limits.cellChars)
    tooLarge("OpenDocument cell text exceeds the character limit");
  return value;
}
function valueOf(node: XmlElement): ExcelJS.CellValue {
  const type = attr(node, "value-type");
  const text = attr(node, "string-value") ?? paragraphs(node);
  if (text.length > limits.cellChars)
    tooLarge("OpenDocument cell text exceeds the character limit");
  let value: ExcelJS.CellValue;
  if (["float", "percentage", "currency"].includes(type ?? "")) {
    const source = attr(node, "value");
    if (
      source === undefined ||
      source.trim() === "" ||
      !Number.isFinite(Number(source))
    )
      invalid("Invalid OpenDocument numeric value");
    value = Number(source);
  } else if (type === "boolean") {
    const boolean = attr(node, "boolean-value");
    if (boolean !== "true" && boolean !== "false")
      invalid("Invalid OpenDocument boolean value");
    value = boolean === "true";
  } else if (type === "date") {
    const source = attr(node, "date-value") ?? "";
    const date = new Date(source);
    if (source === "" || !Number.isFinite(date.getTime()))
      invalid("Invalid OpenDocument date value");
    value = date;
  } else if (type === "time") value = attr(node, "time-value") ?? text;
  else if (type === "string" || text !== "") value = text;
  else if (type === undefined || type === "void") value = null;
  else invalid("Unsupported OpenDocument cell value type");
  const formula = attr(node, "formula");
  if (formula !== undefined) {
    if (formula.length > limits.cellChars || formula.trim() === "")
      invalid("Invalid OpenDocument formula");
    return {
      formula,
      ...(value === null
        ? {}
        : { result: value as string | number | boolean | Date }),
    };
  }
  return value;
}
function xmlDocument(bytes: Buffer): XmlElement {
  let text: string;
  try {
    const encoding = bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))
      ? "utf-16le"
      : bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))
        ? "utf-16be"
        : "utf-8";
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentError(
      "EXTRACTION_FAILED",
      "OpenDocument XML has an unsupported or invalid encoding",
    );
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(text))
    invalid("OpenDocument XML entity declarations are unsupported");
  if (
    [...text.matchAll(/<(?:[\w.-]+:)?(?:table-cell|covered-table-cell)\b/gu)]
      .length > limits.cells
  )
    tooLarge("OpenDocument contains too many stored cells");
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch {
    throw new DocumentError(
      "EXTRACTION_FAILED",
      "OpenDocument XML could not be parsed",
    );
  }
  if (
    descendants(root, "scripts").some((node) =>
      node.children.some(
        (child) => child.kind === "element" || child.value.trim() !== "",
      ),
    ) ||
    descendants(root, "event-listener").length > 0
  )
    throw new DocumentError(
      "MACRO_ENABLED_DOCUMENT",
      "OpenDocument scripts and event listeners are unsupported",
    );
  return root;
}
function odsContent(bytes: Buffer, signal?: AbortSignal): Buffer {
  const entries = readZipEntries(bytes);
  if (entries === undefined || entries.length > limits.entries)
    invalid("Invalid or oversized ODS archive");
  let content: Buffer | undefined;
  let mimetype: string | undefined;
  let expanded = 0;
  const names = new Set<string>();
  for (const entry of entries) {
    checkSignal(signal);
    if (
      names.has(entry.name) ||
      entry.name.startsWith("/") ||
      entry.name.includes("\\") ||
      entry.name.split("/").includes("..")
    )
      invalid("ODS contains duplicate or unsafe ZIP entry names");
    names.add(entry.name);
    if (/^(?:Basic|Scripts)\//iu.test(entry.name))
      throw new DocumentError(
        "MACRO_ENABLED_DOCUMENT",
        "OpenDocument script containers are unsupported",
      );
    if (expanded + entry.uncompressedSize > limits.expandedBytes)
      tooLarge("ODS expanded contents exceed 64 MiB");
    const data = readZipEntry(bytes, entry);
    if (data === undefined)
      invalid("ODS contains an unreadable or oversized ZIP entry");
    expanded += data.length;
    if (expanded > limits.expandedBytes)
      tooLarge("ODS expanded contents exceed 64 MiB");
    if (entry.name === "mimetype") mimetype = data.toString("utf8");
    if (entry.name === "content.xml") content = data;
    if (entry.name === "META-INF/manifest.xml") {
      const root = xmlDocument(data);
      if (descendants(root, "encryption-data").length > 0)
        throw new DocumentError(
          "ENCRYPTED_DOCUMENT",
          "Encrypted ODS files are unsupported",
        );
    }
    if (
      entry.name.endsWith(".xml") &&
      entry.name !== "content.xml" &&
      entry.name !== "META-INF/manifest.xml"
    )
      xmlDocument(data);
  }
  if (mimetype !== ODS_MEDIA_TYPE || content === undefined)
    throw new DocumentError(
      "UNSUPPORTED_FORMAT",
      "Expected an OpenDocument spreadsheet package",
    );
  return content;
}
function tableRows(table: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  function visit(node: XmlElement) {
    for (const child of children(node)) {
      if (child.name === "table-row") result.push(child);
      else if (
        ["table-row-group", "table-header-rows", "table-rows"].includes(
          child.name,
        )
      )
        visit(child);
    }
  }
  visit(table);
  return result;
}
export function readOpenDocument(
  bytes: Buffer,
  format: "ods" | "fods",
  signal?: AbortSignal,
) {
  const root = xmlDocument(
    format === "ods" ? odsContent(bytes, signal) : bytes,
  );
  const document = children(root)[0];
  if (
    document === undefined ||
    !["document", "document-content"].includes(document.name)
  )
    invalid("Expected OpenDocument XML");
  const body = children(document).find((node) => node.name === "body");
  const spreadsheet =
    body === undefined
      ? undefined
      : children(body).find((node) => node.name === "spreadsheet");
  if (spreadsheet === undefined)
    invalid("OpenDocument contains no spreadsheet body");
  const tables = children(spreadsheet).filter((node) => node.name === "table");
  if (tables.length === 0 || tables.length > limits.sheets)
    invalid("OpenDocument sheet count must be between 1 and 128");
  const workbook = new ExcelJS.Workbook();
  let cells = 0;
  let rangeArea = 0;
  const names = new Set<string>();
  for (const table of tables) {
    checkSignal(signal);
    const name = attr(table, "name") ?? "";
    if (
      name === "" ||
      name.length > 31 ||
      /[\\/*?:[\]]/u.test(name) ||
      name.startsWith("'") ||
      name.endsWith("'") ||
      names.has(name.toLowerCase())
    )
      invalid(
        "OpenDocument sheet names must be unique and compatible with the shared spreadsheet tools",
      );
    names.add(name.toLowerCase());
    const sheet = workbook.addWorksheet(name);
    const rowGroups = tableRows(table).map((row) => {
      const groups = children(row)
        .filter((cell) =>
          ["table-cell", "covered-table-cell"].includes(cell.name),
        )
        .map((cell) => ({
          node: cell,
          value: valueOf(cell),
          repeat: repetition(cell, "number-columns-repeated"),
        }));
      // Full-grid trailing blank repeats are common in LibreOffice files.
      while (
        groups.at(-1)?.value === null &&
        groups.at(-1)?.node.name !== "covered-table-cell" &&
        attr(groups.at(-1)!.node, "number-columns-spanned") === undefined &&
        attr(groups.at(-1)!.node, "number-rows-spanned") === undefined
      )
        groups.pop();
      return { groups, repeat: repetition(row, "number-rows-repeated") };
    });
    while (rowGroups.at(-1)?.groups.length === 0) rowGroups.pop();
    let rowIndex = 1;
    const merges: [number, number, number, number][] = [];
    for (const group of rowGroups) {
      if (rowIndex + group.repeat - 1 > limits.rows)
        tooLarge("OpenDocument row repetition exceeds the row budget");
      for (let r = 0; r < group.repeat; r += 1) {
        checkSignal(signal);
        const values: ExcelJS.CellValue[] = [];
        let column = 1;
        for (const cell of group.groups) {
          if (column + cell.repeat - 1 > limits.columns)
            tooLarge(
              "OpenDocument column repetition exceeds the column budget",
            );
          cells += cell.repeat;
          if (cells > limits.cells)
            tooLarge("OpenDocument repetitions exceed the 200000 cell budget");
          const rowSpan = repetition(cell.node, "number-rows-spanned");
          const colSpan = repetition(cell.node, "number-columns-spanned");
          if (rowSpan > 1 || colSpan > 1) {
            if (
              rowIndex + rowSpan - 1 > limits.rows ||
              column + colSpan - 1 > limits.columns ||
              cell.repeat > 1
            )
              tooLarge(
                "OpenDocument merged range exceeds the supported budget",
              );
            rangeArea += rowSpan * colSpan;
            if (
              rangeArea > limits.cells ||
              merges.length >= limits.mergedRanges
            )
              tooLarge(
                "OpenDocument merged ranges exceed the expansion budget",
              );
            merges.push([
              rowIndex,
              column,
              rowIndex + rowSpan - 1,
              column + colSpan - 1,
            ]);
          }
          for (let c = 0; c < cell.repeat; c += 1) values.push(cell.value);
          column += cell.repeat;
        }
        sheet.getRow(rowIndex).values = values;
        rowIndex += 1;
      }
    }
    for (const merge of merges) {
      try {
        sheet.mergeCells(...merge);
      } catch {
        invalid("OpenDocument contains overlapping merged ranges");
      }
    }
  }
  return { workbook, warnings: [WARNING] };
}

function escapeXml(value: string): string {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      (code < 32 && ![9, 10, 13].includes(code)) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      invalid("OpenDocument text contains invalid XML characters");
  }
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;")
    .replace(/\r/gu, "&#13;")
    .replace(/\n/gu, "&#10;")
    .replace(/\t/gu, "&#9;");
}
function odfCell(cell: ExcelJS.Cell): string {
  let value = cell.value;
  let formula = "";
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    if (
      !("formula" in value) ||
      typeof value.formula !== "string" ||
      !value.formula.startsWith("of:=")
    )
      invalid(
        "ODS/FODS formulas must use explicit OpenFormula syntax, for example of:=SUM([.B2:.B3])",
      );
    formula = ` table:formula="${escapeXml(value.formula)}"`;
    value = value.result ?? null;
  }
  if (value === null) return `<table:table-cell${formula}/>`;
  if (value instanceof Date)
    return `<table:table-cell${formula} office:value-type="date" office:date-value="${value.toISOString()}"/>`;
  if (typeof value === "number")
    return `<table:table-cell${formula} office:value-type="float" office:value="${value}"/>`;
  if (typeof value === "boolean")
    return `<table:table-cell${formula} office:value-type="boolean" office:boolean-value="${value}"/>`;
  if (typeof value !== "string")
    invalid("Unsupported OpenDocument output value");
  return `<table:table-cell${formula} office:value-type="string" office:string-value="${escapeXml(value)}"><text:p>${escapeXml(value)}</text:p></table:table-cell>`;
}
export async function writeOpenDocument(
  workbook: ExcelJS.Workbook,
  format: "ods" | "fods",
) {
  const tables = workbook.worksheets
    .map((sheet) => {
      const rows: string[] = [];
      for (let row = 1; row <= sheet.rowCount; row += 1) {
        const cells: string[] = [];
        for (let column = 1; column <= sheet.getRow(row).cellCount; column += 1)
          cells.push(odfCell(sheet.getCell(row, column)));
        rows.push(`<table:table-row>${cells.join("")}</table:table-row>`);
      }
      return `<table:table table:name="${escapeXml(sheet.name)}">${rows.join("")}</table:table>`;
    })
    .join("");
  const tag = format === "fods" ? "office:document" : "office:document-content";
  const xml = `<?xml version="1.0" encoding="UTF-8"?><${tag} ${NS} office:version="1.3"${format === "fods" ? ` office:mimetype="${ODS_MEDIA_TYPE}"` : ""}><office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body></${tag}>`;
  if (Buffer.byteLength(xml) > limits.expandedBytes)
    tooLarge("OpenDocument output exceeds the expanded byte budget");
  if (format === "fods")
    return { bytes: Buffer.from(xml), warnings: [WARNING] };
  const zip = new JSZip();
  zip.file("mimetype", ODS_MEDIA_TYPE, { compression: "STORE" });
  zip.file("content.xml", xml);
  zip.file(
    "META-INF/manifest.xml",
    `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODS_MEDIA_TYPE}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
  );
  return {
    bytes: await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    }),
    warnings: [WARNING],
  };
}
