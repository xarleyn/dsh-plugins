import type ExcelJS from "exceljs";
import { sha256Hex } from "../artifacts/store.js";
import {
  invalid,
  tooLarge,
  checkSignal,
  positiveInteger,
  SPREADSHEET_LIMITS as limits,
} from "./guards.js";
import { cellInfo } from "./workbook.js";
import type { SpreadsheetCell } from "./types.js";
import type {
  SpreadsheetCellPreview,
  SpreadsheetSelection,
} from "./query-types.js";

export function booleanOption(
  value: unknown,
  fallback: boolean,
  label: string,
): boolean {
  if (value !== undefined && typeof value !== "boolean")
    invalid(`${label} must be boolean`);
  return value === undefined ? fallback : (value as boolean);
}
export function chooseSheets(
  available: readonly string[],
  requested: readonly string[] | undefined,
): string[] {
  if (requested === undefined) return [...available];
  if (
    !Array.isArray(requested) ||
    !requested.length ||
    requested.length > limits.sheets ||
    requested.some(
      (name) => typeof name !== "string" || !available.includes(name),
    ) ||
    new Set(requested).size !== requested.length
  )
    invalid(
      "sheets must contain unique exact sheet names from spreadsheet_inspect",
    );
  // Workbook order is stable even when a caller reorders a selection.
  return available.filter((name) => requested.includes(name));
}
export function cellPosition(value: string): { row: number; column: number } {
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]*)$/u.exec(value.toUpperCase());
  if (!match) invalid("range must be an A1 cell or rectangle such as A1:D100");
  return {
    row: positiveInteger(Number(match[2]), 1, limits.rows, "range row"),
    column: positiveInteger(
      [...match[1]!].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0),
      1,
      limits.columns,
      "range column",
    ),
  };
}
export function selectionRange(value: unknown) {
  if (value === undefined)
    return {
      first: { row: 1, column: 1 },
      last: { row: limits.rows, column: limits.columns },
    };
  if (typeof value !== "string") invalid("range must be an A1 string");
  const ends = value.split(":");
  if (ends.length > 2) invalid("Invalid range");
  const first = cellPosition(ends[0]!),
    last = cellPosition(ends[1] ?? ends[0]!);
  if (first.row > last.row || first.column > last.column)
    invalid("Invalid range bounds");
  return { first, last };
}
export type SelectionRange = ReturnType<typeof selectionRange>;
/** Enumerate stored cells, including styled blanks, without scanning a sparse rectangle. */
export function cells(
  sheet: ExcelJS.Worksheet | undefined,
  range: SelectionRange,
  signal?: AbortSignal,
): Map<string, ExcelJS.Cell> {
  const result = new Map<string, ExcelJS.Cell>();
  if (!sheet) return result;
  let count = 0;
  for (
    let rowNumber = range.first.row;
    rowNumber <= Math.min(range.last.row, sheet.rowCount);
    rowNumber++
  ) {
    const row = sheet.findRow(rowNumber);
    for (const model of row?.model?.cells ?? []) {
      checkSignal(signal);
      if (++count > limits.cells)
        tooLarge("Query exceeds the 200000 stored-cell budget");
      // ExcelJS emits a string here; its declaration also permits an Address object.
      const address =
        typeof model.address === "string"
          ? model.address
          : model.address.address;
      const cell = sheet.getCell(address);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      if (
        Number(cell.row) < range.first.row ||
        Number(cell.row) > range.last.row ||
        Number(cell.col) < range.first.column ||
        Number(cell.col) > range.last.column
      )
        continue;
      result.set(cell.address, cell);
    }
  }
  return result;
}
export function orderedAddresses(
  ...maps: Map<string, ExcelJS.Cell>[]
): string[] {
  return [...new Set(maps.flatMap((map) => [...map.keys()]))].sort((a, b) => {
    const x = cellPosition(a),
      y = cellPosition(b);
    return x.row - y.row || x.column - y.column;
  });
}
export function fullCell(
  cell: ExcelJS.Cell | undefined,
  address: string,
): SpreadsheetCell {
  return cell ? cellInfo(cell) : { address, value: null, type: "blank" };
}
export function preview(cell: SpreadsheetCell): SpreadsheetCellPreview {
  const truncatedFields: string[] = [];
  const clip = (text: string, field: string) => {
    if (text.length <= 512) return text;
    truncatedFields.push(field);
    return text.slice(0, 512) + "…";
  };
  return {
    ...cell,
    value:
      typeof cell.value === "string" ? clip(cell.value, "value") : cell.value,
    ...(cell.formula === undefined
      ? {}
      : { formula: clip(cell.formula, "formula") }),
    ...(cell.hyperlink === undefined
      ? {}
      : { hyperlink: clip(cell.hyperlink, "hyperlink") }),
    ...(cell.numberFormat === undefined
      ? {}
      : { numberFormat: clip(cell.numberFormat, "numberFormat") }),
    truncatedFields,
  };
}
export function canonical(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item !== null && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b, "en"))
          .map(([k, v]) => [k, sort(v)]),
      );
    return item;
  };
  return JSON.stringify(sort(value)) ?? "undefined";
}
/** A cursor is bound to source bytes and effective options, never an input capability. */
export function paginate<T>(
  items: Iterable<T>,
  input: SpreadsheetSelection,
  fingerprint: unknown,
  maxChars: number,
  header: unknown,
) {
  const key = sha256Hex(canonical({ version: 1, fingerprint }));
  let offset = 0;
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== "string" || input.cursor.length > 512)
      invalid("Invalid query cursor");
    try {
      const cursor = JSON.parse(
        Buffer.from(input.cursor, "base64url").toString("utf8"),
      ) as { key?: unknown; offset?: unknown };
      if (
        cursor.key !== key ||
        typeof cursor.offset !== "number" ||
        !Number.isSafeInteger(cursor.offset) ||
        cursor.offset < 0
      )
        invalid(
          "Cursor no longer matches source or query; start again without a cursor",
        );
      offset = cursor.offset;
    } catch {
      invalid(
        "Cursor no longer matches source or query; start again without a cursor",
      );
    }
  }
  const limit = positiveInteger(input.limit, 50, 200, "limit");
  const page: T[] = [];
  let total = 0,
    chars = JSON.stringify(header).length + 512,
    collecting = true;
  if (chars > maxChars)
    tooLarge(
      "Query metadata exceeds extraction.maxInlineChars; select fewer sheets",
    );
  for (const item of items) {
    const index = total++;
    if (index < offset || !collecting) continue;
    const size = JSON.stringify(item).length + 1;
    if (page.length >= limit || chars + size > maxChars) {
      if (!page.length)
        tooLarge(
          "One query record exceeds extraction.maxInlineChars; narrow the selection or increase the budget",
        );
      collecting = false;
      continue;
    }
    page.push(item);
    chars += size;
  }
  if (offset > total) invalid("Cursor offset exceeds query results");
  return {
    items: page,
    total,
    nextCursor:
      offset + page.length < total
        ? Buffer.from(
            JSON.stringify({ key, offset: offset + page.length }),
          ).toString("base64url")
        : null,
  };
}
