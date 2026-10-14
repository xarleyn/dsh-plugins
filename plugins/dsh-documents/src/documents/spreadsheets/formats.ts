import ExcelJS from "exceljs";
import path from "node:path";
import { DocumentError } from "../errors.js";
import { readZipEntries } from "../inspect/zip.js";
import { invalid, validateXlsx } from "./guards.js";
import { readDelimited, writeDelimited } from "./delimited.js";
import {
  ODS_MEDIA_TYPE,
  readOpenDocument,
  writeOpenDocument,
} from "./opendocument.js";
import type {
  SpreadsheetCreateInput,
  SpreadsheetFormat,
  SpreadsheetInspectInput,
} from "./types.js";

export const SPREADSHEET_FORMATS = [
  "xlsx",
  "csv",
  "tsv",
  "ods",
  "fods",
] as const;
export function checkedFormat(value: unknown): SpreadsheetFormat {
  if (!SPREADSHEET_FORMATS.includes(value as SpreadsheetFormat))
    invalid("format must be xlsx, csv, tsv, ods or fods");
  return value as SpreadsheetFormat;
}
export function spreadsheetMediaType(format: SpreadsheetFormat): string {
  return {
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ods: ODS_MEDIA_TYPE,
    fods: "application/vnd.oasis.opendocument.spreadsheet-flat-xml",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
  }[format];
}
export function inputFormat(
  bytes: Buffer,
  filename: string,
  input: SpreadsheetInspectInput,
): SpreadsheetFormat {
  const entries = readZipEntries(bytes);
  const zipFormat = entries?.some((entry) => entry.name === "xl/workbook.xml")
    ? "xlsx"
    : entries?.some((entry) => entry.name === "content.xml")
      ? "ods"
      : undefined;
  if (input.format !== undefined) {
    const format = checkedFormat(input.format);
    if (zipFormat !== undefined && format !== zipFormat)
      invalid("format conflicts with the workbook container");
    return format;
  }
  if (zipFormat !== undefined) return zipFormat;
  const extension = path.extname(filename).slice(1).toLowerCase();
  if (["csv", "tsv", "fods"].includes(extension))
    return checkedFormat(extension);
  throw new DocumentError(
    "UNSUPPORTED_FORMAT",
    "Expected XLSX, ODS, FODS, CSV or TSV; specify format for text files without a recognized extension",
  );
}
export async function decodeWorkbook(
  bytes: Buffer,
  filename: string,
  input: SpreadsheetInspectInput,
  signal?: AbortSignal,
) {
  const format = inputFormat(bytes, filename, input);
  if (!["csv", "tsv"].includes(format) && input.text !== undefined)
    invalid("text options apply only to CSV/TSV");
  if (format === "csv" || format === "tsv")
    return { ...readDelimited(bytes, format, input.text, signal), format };
  if (format === "ods" || format === "fods")
    return { ...readOpenDocument(bytes, format, signal), format };
  validateXlsx(bytes, signal);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw new DocumentError(
      "EXTRACTION_FAILED",
      "XLSX workbook could not be parsed",
    );
  }
  return {
    workbook,
    format,
    warnings: [
      "Formula results are cached values from the last save and may be stale or absent. Formulas are not calculated here.",
    ],
  };
}
export async function encodeWorkbook(
  workbook: ExcelJS.Workbook,
  input: SpreadsheetCreateInput,
  signal?: AbortSignal,
) {
  const format = checkedFormat(input.format ?? "xlsx");
  if (!["csv", "tsv"].includes(format) && input.text !== undefined)
    invalid("text options apply only to CSV/TSV");
  if (format === "csv" || format === "tsv")
    return { ...writeDelimited(workbook, format, input), format };
  if (format === "ods" || format === "fods")
    return { ...(await writeOpenDocument(workbook, format)), format };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  } catch {
    throw new DocumentError(
      "RENDER_FAILED",
      "XLSX workbook could not be written",
    );
  }
  validateXlsx(bytes, signal);
  return {
    bytes,
    format,
    warnings: [
      "Formula results are cached values from the last save and may be stale or absent. Formulas are not calculated here.",
    ],
  };
}
