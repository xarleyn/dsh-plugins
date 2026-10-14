import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import iconv from "iconv-lite";
import { DocumentError } from "../errors.js";
import {
  checkSignal,
  invalid,
  SPREADSHEET_LIMITS as limits,
  tooLarge,
} from "./guards.js";
import type {
  SpreadsheetCreateInput,
  SpreadsheetEncoding,
  SpreadsheetTextOptions,
} from "./types.js";

const ENCODINGS = ["utf-8", "utf-16le", "utf-16be", "windows-1251"] as const;
const DELIMITERS = [",", ";", "\t", "|"];

function checkedEncoding(value: unknown): SpreadsheetEncoding {
  if (!ENCODINGS.includes(value as SpreadsheetEncoding))
    invalid("encoding must be utf-8, utf-16le, utf-16be or windows-1251");
  return value as SpreadsheetEncoding;
}

function checkedDelimiter(value: unknown): string {
  if (typeof value !== "string" || !DELIMITERS.includes(value))
    invalid("delimiter must be comma, semicolon, tab or pipe");
  return value;
}

export function decodeDelimited(
  bytes: Buffer,
  options?: SpreadsheetTextOptions,
) {
  const bomEncoding = bytes
    .subarray(0, 3)
    .equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ? "utf-8"
    : bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))
      ? "utf-16le"
      : bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))
        ? "utf-16be"
        : undefined;
  const encoding = checkedEncoding(options?.encoding ?? bomEncoding ?? "utf-8");
  if (bomEncoding !== undefined && encoding !== bomEncoding)
    invalid("encoding conflicts with the file BOM");
  let content: string;
  try {
    content = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentError(
      "EXTRACTION_FAILED",
      "Text could not be decoded; specify its encoding explicitly",
    );
  }
  if (content.includes("\0"))
    invalid("Delimited input contains NUL bytes; check the encoding or format");
  return { content: content.replace(/^\uFEFF/u, ""), encoding };
}

function parseRows(
  content: string,
  delimiter: string,
  to?: number,
): string[][] {
  return parse(content, {
    delimiter,
    bom: true,
    cast: false,
    relax_column_count: true,
    skip_empty_lines: false,
    max_record_size: limits.expandedBytes,
    ...(to === undefined ? {} : { to }),
    on_record: (record: string[], context: { records: number }) => {
      if (context.records > limits.rows)
        tooLarge("Delimited input exceeds the 100000 row budget");
      if (record.length > limits.columns)
        tooLarge("Delimited row exceeds the column budget");
      for (const cell of record)
        if (cell.length > limits.cellChars)
          tooLarge("Delimited cell exceeds the character limit");
      return record;
    },
  }) as string[][];
}

function detectDelimiter(content: string): string {
  const scores = DELIMITERS.map((delimiter) => {
    try {
      const rows = parseRows(content, delimiter, 25).filter((row) =>
        row.some((value) => value !== ""),
      );
      const frequencies = new Map<number, number>();
      for (const row of rows)
        if (row.length > 1)
          frequencies.set(row.length, (frequencies.get(row.length) ?? 0) + 1);
      // Prefer a recurring multi-column width, while allowing shorter records.
      const score = Math.max(
        0,
        ...[...frequencies].map(
          ([width, count]) => count * limits.columns + width,
        ),
      );
      return { delimiter, score };
    } catch {
      return { delimiter, score: 0 };
    }
  });
  const best = Math.max(...scores.map((entry) => entry.score));
  if (best === 0) return ",";
  const candidates = scores.filter((entry) => entry.score === best);
  if (candidates.length !== 1)
    invalid("Delimiter is ambiguous; specify text.delimiter explicitly");
  return candidates[0]!.delimiter;
}

export function readDelimited(
  bytes: Buffer,
  format: "csv" | "tsv",
  options?: SpreadsheetTextOptions,
  signal?: AbortSignal,
) {
  checkSignal(signal);
  const { content, encoding } = decodeDelimited(bytes, options);
  const delimiter =
    options?.delimiter === undefined
      ? format === "tsv"
        ? "\t"
        : detectDelimiter(content)
      : checkedDelimiter(options.delimiter);
  if (format === "tsv" && delimiter !== "\t")
    invalid("TSV requires a tab delimiter; use CSV for other delimiters");
  let cells = 0;
  let rows: string[][];
  try {
    rows = parse(content, {
      delimiter,
      bom: true,
      cast: false,
      relax_column_count: true,
      skip_empty_lines: false,
      max_record_size: limits.expandedBytes,
      on_record: (record: string[], context: { records: number }) => {
        checkSignal(signal);
        if (context.records > limits.rows || record.length > limits.columns)
          tooLarge("Delimited input exceeds the row or column budget");
        cells += record.length;
        if (cells > limits.cells)
          tooLarge("Delimited input exceeds the 200000 cell budget");
        for (const value of record)
          if (value.length > limits.cellChars)
            tooLarge("Delimited cell exceeds the character limit");
        return record;
      },
    }) as string[][];
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError(
      "EXTRACTION_FAILED",
      "Malformed delimited data: check quotes and text.delimiter",
    );
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  for (const row of rows) sheet.addRow(row);
  return {
    workbook,
    text: { delimiter, encoding },
    warnings: [
      "Delimited cells are read as strings; blank fields are empty strings. CSV/TSV do not store sheet names, types, formulas or formatting.",
    ],
  };
}

export function writeDelimited(
  workbook: ExcelJS.Workbook,
  format: "csv" | "tsv",
  input: SpreadsheetCreateInput,
) {
  if (workbook.worksheets.length !== 1)
    invalid(
      "CSV/TSV store exactly one sheet; create separate files or choose XLSX/ODS/FODS",
    );
  const options = input.text;
  const delimiter = checkedDelimiter(
    options?.delimiter ?? (format === "tsv" ? "\t" : ","),
  );
  if (format === "tsv" && delimiter !== "\t")
    invalid("TSV requires a tab delimiter");
  const encoding = checkedEncoding(options?.encoding ?? "utf-8");
  if (options?.bom !== undefined && typeof options.bom !== "boolean")
    invalid("text.bom must be boolean");
  if (
    options?.escapeFormulas !== undefined &&
    typeof options.escapeFormulas !== "boolean"
  )
    invalid("text.escapeFormulas must be boolean");
  const source = input.sheets[0]!;
  const rows = source.rows.map((row) =>
    row.map((value) => {
      if (value !== null && typeof value === "object") {
        if ("formula" in value)
          invalid(
            "CSV/TSV cannot store formula cells; supply literal values instead",
          );
        return value.date;
      }
      if (
        typeof value === "string" &&
        (options?.escapeFormulas ?? true) &&
        ["=", "+", "-", "@", "\t", "\r", "＝", "＋", "－", "＠"].includes(
          value.charAt(0),
        )
      )
        return `'${value}`;
      return typeof value === "boolean" ? String(value) : value;
    }),
  );
  const content = stringify(rows, {
    delimiter,
    record_delimiter: "\r\n",
    escape_formulas: false,
  });
  const bytes = iconv.encode(content, encoding);
  if (iconv.decode(bytes, encoding) !== content)
    invalid(
      "Text cannot be represented losslessly in the requested encoding; use UTF-8",
    );
  const bom = options?.bom ?? true;
  const prefix =
    !bom || encoding === "windows-1251"
      ? Buffer.alloc(0)
      : encoding === "utf-8"
        ? Buffer.from([0xef, 0xbb, 0xbf])
        : encoding === "utf-16le"
          ? Buffer.from([0xff, 0xfe])
          : Buffer.from([0xfe, 0xff]);
  return {
    bytes: Buffer.concat([prefix, bytes]),
    warnings: [
      "CSV/TSV store one sheet of text; types, formatting and sheet names are not preserved.",
      (options?.escapeFormulas ?? true)
        ? "Text starting with formula-trigger characters is prefixed with an apostrophe for spreadsheet import; set text.escapeFormulas=false only when literal fidelity is intended."
        : "Formula-trigger text is exported verbatim and may be interpreted as a formula by a spreadsheet application.",
    ],
  };
}
