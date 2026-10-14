import { DocumentError } from "../errors.js";
import { readZipEntries, readZipEntry } from "../inspect/zip.js";

/** In addition to the configured input/inline budgets, bound XLSX expansion. */
export const SPREADSHEET_LIMITS = {
  sheets: 128,
  rows: 100_000,
  columns: 16_384,
  cells: 200_000,
  pageCells: 2_000,
  expandedBytes: 64 * 1024 * 1024,
  entries: 2_048,
  cellChars: 32_767,
  mergedRanges: 2_000,
} as const;

export function invalid(message: string): never {
  throw new DocumentError("INVALID_INPUT", message);
}

export function tooLarge(message: string): never {
  throw new DocumentError("DOCUMENT_TOO_LARGE", message);
}

export function positiveInteger(
  value: unknown,
  fallback: number,
  max: number,
  label: string,
): number {
  const number = value === undefined ? fallback : value;
  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < 1 ||
    number > max
  )
    invalid(`${label} must be an integer between 1 and ${max}`);
  return number;
}

export function checkSignal(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

/** Check actual inflated bytes, names and cell coordinates before ExcelJS loads anything. */
export function validateXlsx(bytes: Buffer, signal?: AbortSignal): void {
  const entries = readZipEntries(bytes);
  if (
    entries === undefined ||
    !entries.some((entry) => entry.name === "xl/workbook.xml")
  ) {
    throw new DocumentError(
      "UNSUPPORTED_FORMAT",
      "Expected an unencrypted XLSX workbook. Legacy XLS and encrypted files are unsupported.",
    );
  }
  if (entries.length > SPREADSHEET_LIMITS.entries)
    tooLarge("XLSX has too many ZIP entries");
  const names = new Set<string>();
  let expanded = 0;
  let cells = 0;
  let sheets = 0;
  for (const entry of entries) {
    checkSignal(signal);
    if (
      names.has(entry.name) ||
      entry.name.includes("\\") ||
      entry.name.startsWith("/") ||
      entry.name.split("/").includes("..")
    )
      invalid("XLSX contains duplicate or unsafe ZIP entry names");
    names.add(entry.name);
    if (/vbaProject|macrosheets/iu.test(entry.name))
      throw new DocumentError(
        "MACRO_ENABLED_DOCUMENT",
        "Macro-enabled workbooks are unsupported",
      );
    if (expanded + entry.uncompressedSize > SPREADSHEET_LIMITS.expandedBytes)
      tooLarge("XLSX expanded contents exceed 64 MiB");
    const data = readZipEntry(bytes, entry);
    if (data === undefined)
      invalid("XLSX contains an unreadable or oversized ZIP entry");
    expanded += data.length;
    if (expanded > SPREADSHEET_LIMITS.expandedBytes)
      tooLarge("XLSX expanded contents exceed 64 MiB");
    if (!entry.name.endsWith(".xml")) continue;
    const xml = data.toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/iu.test(xml))
      invalid("XLSX XML declarations with entities are unsupported");
    if (/macroEnabled/iu.test(xml))
      throw new DocumentError(
        "MACRO_ENABLED_DOCUMENT",
        "Macro-enabled workbooks are unsupported",
      );
    if (
      entry.name === "xl/workbook.xml" &&
      [...xml.matchAll(/<(?:\w+:)?sheet\b/gu)].length >
        SPREADSHEET_LIMITS.sheets
    )
      tooLarge("XLSX has more than 128 sheets");
    if (!/^xl\/worksheets\/[^/]+\.xml$/u.test(entry.name)) continue;
    sheets += 1;
    if (sheets > SPREADSHEET_LIMITS.sheets)
      tooLarge("XLSX has more than 128 sheets");
    if (
      [...xml.matchAll(/<(?:\w+:)?mergeCell\b/gu)].length >
      SPREADSHEET_LIMITS.mergedRanges
    )
      tooLarge("XLSX has more than 2000 merged ranges in one sheet");
    let expandedColumns = 0;
    for (const match of xml.matchAll(/<(?:\w+:)?col\b[^>]*>/gu)) {
      const columns = [
        ...match[0].matchAll(/\b(?:min|max)\s*=\s*["']([^"']*)["']/gu),
      ].map((attribute) =>
        positiveInteger(
          Number(attribute[1]),
          1,
          SPREADSHEET_LIMITS.columns,
          "Column range",
        ),
      );
      if (columns.length !== 2) invalid("Invalid XLSX column range");
      expandedColumns += Math.abs(columns[1]! - columns[0]!) + 1;
      if (expandedColumns > SPREADSHEET_LIMITS.cells)
        tooLarge("XLSX column ranges exceed the expansion budget");
    }
    for (const match of xml.matchAll(
      /<(?:\w+:)?(?:row|c)\b[^>]*\br\s*=\s*["']([^"']*)["']/gu,
    )) {
      coordinates(match[1] ?? "");
    }
    // ExcelJS materializes merged and validation ranges, even when cells are absent.
    let rangeCells = 0;
    for (const match of xml.matchAll(
      /\b(?:ref|sqref)\s*=\s*["']([^"']*)["']/gu,
    )) {
      for (const range of (match[1] ?? "").trim().split(/\s+/u)) {
        const ends = range.split(":");
        if (ends.length > 2) invalid("Invalid XLSX range");
        const start = coordinates(ends[0] ?? "");
        const end = coordinates(ends[1] ?? ends[0] ?? "");
        if (end.row < start.row || end.column < start.column)
          invalid("Invalid XLSX range bounds");
        const area =
          (end.row - start.row + 1) * (end.column - start.column + 1);
        if (area > SPREADSHEET_LIMITS.cells)
          tooLarge("XLSX range exceeds the 200000 cell budget");
        rangeCells += area;
        if (rangeCells > SPREADSHEET_LIMITS.cells * 4)
          tooLarge("XLSX ranges exceed the expansion budget");
      }
    }
    cells += [...xml.matchAll(/<(?:\w+:)?c\b/gu)].length;
    if (cells > SPREADSHEET_LIMITS.cells)
      tooLarge("XLSX has more than 200000 stored cells");
  }
}

function coordinates(value: string): { row: number; column: number } {
  const match = /^\$?([A-Z]*)\$?([0-9]+)$/u.exec(value);
  if (match === null) invalid("Invalid XLSX cell coordinates");
  const row = Number(match[2]);
  const column = [...(match[1] ?? "")].reduce(
    (n, c) => n * 26 + c.charCodeAt(0) - 64,
    0,
  );
  if (
    row < 1 ||
    row > SPREADSHEET_LIMITS.rows ||
    column > SPREADSHEET_LIMITS.columns
  )
    tooLarge("XLSX cell coordinates exceed the row or column budget");
  return { row, column };
}
