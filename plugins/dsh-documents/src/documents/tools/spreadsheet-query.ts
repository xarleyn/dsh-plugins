import { defineTool, type ValueSchemaSpec } from "@deepseek-ai/dsh-tools";
import {
  fileParameter,
  requireDocumentScope,
  type DocumentToolExec,
  type DocumentToolOptions,
} from "./shared.js";
import type {
  SpreadsheetFindInput,
  SpreadsheetDiffInput,
  SpreadsheetCellPreview,
} from "../spreadsheets/query-types.js";

const strings = {
  type: "array",
  items: { type: "string" },
} satisfies ValueSchemaSpec;
const source = {
  type: "object",
  additionalProperties: false,
  properties: {
    filename: { type: "string", required: true },
    sha256: { type: "string", required: true },
    format: { type: "string", required: true },
  },
} satisfies ValueSchemaSpec;
const cell = {
  type: "object",
  additionalProperties: false,
  properties: {
    address: { type: "string", required: true },
    value: {
      oneOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
      ],
      required: true,
    },
    type: { type: "string", required: true },
    formula: { type: "string" },
    numberFormat: { type: "string" },
    hyperlink: { type: "string" },
    truncatedFields: { ...strings, required: true },
  },
} satisfies ValueSchemaSpec;
const sheet = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", required: true },
    state: { type: "string", required: true },
    rows: { type: "integer", required: true },
    columns: { type: "integer", required: true },
    nonEmptyRows: { type: "integer", required: true },
    mergedRangeCount: { type: "integer", required: true },
    mergedRangesSha256: { type: "string", required: true },
  },
} satisfies ValueSchemaSpec;
const text = {
  type: "object",
  additionalProperties: false,
  properties: {
    delimiter: { type: "string" },
    encoding: {
      type: "string",
      enum: ["utf-8", "utf-16le", "utf-16be", "windows-1251"],
    },
  },
} satisfies ValueSchemaSpec;
const format = {
  type: "string",
  enum: ["xlsx", "csv", "tsv", "ods", "fods"],
} satisfies ValueSchemaSpec;
const selection = {
  sheets: {
    ...strings,
    description:
      "Optional exact sheet names. Default all sheets, including hidden. Merged slave cells are not separate records.",
  },
  range: {
    type: "string",
    description:
      "Optional inclusive A1 rectangle, e.g. B2:D100. Restricts cells only, not sheet metadata or package hashes.",
  },
  limit: {
    type: "integer",
    description:
      "Maximum records per page: default 50, at most 200; inline budget can shorten the page.",
  },
  cursor: {
    type: "string",
    description:
      "Opaque nextCursor from the prior result. Reuse the same source and options; source or query changes invalidate it.",
  },
} as const;
const cursor = {
  oneOf: [{ type: "string" }, { type: "null" }],
  required: true,
} as const;
const wireCell = (value: SpreadsheetCellPreview) => ({
  ...value,
  truncatedFields: [...value.truncatedFields],
});
const render = (_args: unknown, value: unknown) => [
  { type: "text" as const, text: JSON.stringify(value) },
];

export function createSpreadsheetFindTool(options: DocumentToolOptions) {
  return defineTool({
    name: "spreadsheet_find",
    description:
      "Find literal text in spreadsheet values, formulas or both across selected sheets/ranges. Supports XLSX/CSV/TSV/ODS/FODS; defaults to case-insensitive contains over all sheets including hidden. Text search never coerces leading-zero IDs. Results carry source SHA-256, addresses, types, totalMatches and nextCursor. Values/formulas are previews (truncatedFields marks shortening); read full cells before editing. Empty query and regex are unsupported. Saved formula results are not recalculated. Read-only; accepts directly admitted chat attachments.",
    parameters: {
      file: fileParameter(),
      format,
      text,
      ...selection,
      query: { type: "string", required: true },
      match: { type: "string", enum: ["contains", "exact"] },
      caseSensitive: { type: "boolean" },
      searchIn: { type: "string", enum: ["value", "formula", "either"] },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { ...source, required: true },
          sheets: { ...strings, required: true },
          matches: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                sheet: { type: "string", required: true },
                cell: { ...cell, required: true },
                matchedIn: { ...strings, required: true },
              },
            },
          },
          totalMatches: { type: "integer", required: true },
          nextCursor: cursor,
          warnings: { ...strings, required: true },
        },
      },
      render,
    },
    timeoutMs: 60_000,
    async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
      const result = await options.runtime.findSpreadsheet(
        args as unknown as SpreadsheetFindInput,
        requireDocumentScope(exec, options),
      );
      return {
        ...result,
        sheets: [...result.sheets],
        warnings: [...result.warnings],
        matches: result.matches.map((match) => ({
          ...match,
          cell: wireCell(match.cell),
          matchedIn: [...match.matchedIn],
        })),
      };
    },
  });
}

export function createSpreadsheetDiffTool(options: DocumentToolOptions) {
  return defineTool({
    name: "spreadsheet_diff",
    description:
      "Compare two admitted spreadsheet files by exact sheet name and A1 address; read-only. Supports XLSX/CSV/TSV/ODS/FODS. Reports added/removed/changed cells, sheet metadata and sheet order with full-result counts and paginated changes. Formula expressions are compared; cache-only differences are ignored unless compareCachedResults=true. compareFormatting adds cell style/rich-text comparison. comparePackageParts=true compares every uncompressed XLSX part hash (including charts/images); requires two XLSX and covers whole packages regardless of range. This is a byte-part comparison, not a visual comparison. Cell values/formulas are bounded previews; equality uses full data. No formula recalculation. Use before delivering an edited artifact.",
    parameters: {
      before: {
        ...fileParameter(),
        description:
          "Original file, including a directly admitted chat attachment.",
      },
      after: {
        ...fileParameter(),
        description: "Second file or newly edited artifact path.",
      },
      beforeFormat: format,
      afterFormat: format,
      beforeText: text,
      afterText: text,
      ...selection,
      compareCachedResults: { type: "boolean" },
      compareFormatting: { type: "boolean" },
      comparePackageParts: { type: "boolean" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          before: { ...source, required: true },
          after: { ...source, required: true },
          sheets: { ...strings, required: true },
          compareCachedResults: { type: "boolean", required: true },
          compareFormatting: { type: "boolean", required: true },
          packagePartsCompared: { type: "boolean", required: true },
          totalChanges: { type: "integer", required: true },
          totalCellChanges: { type: "integer", required: true },
          totalSheetChanges: { type: "integer", required: true },
          totalPackageChanges: { type: "integer", required: true },
          nextCursor: cursor,
          warnings: { ...strings, required: true },
          changes: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: {
                  type: "string",
                  enum: ["cell", "sheet", "sheet_order", "package_part"],
                  required: true,
                },
                sheet: { type: "string" },
                address: { type: "string" },
                before: { oneOf: [cell, sheet] },
                after: { oneOf: [cell, sheet] },
                valueChanged: { type: "boolean" },
                formulaChanged: { type: "boolean" },
                typeChanged: { type: "boolean" },
                hyperlinkChanged: { type: "boolean" },
                formattingChanged: { type: "boolean" },
                beforeOrder: strings,
                afterOrder: strings,
                part: { type: "string" },
                beforeSha256: { type: "string" },
                afterSha256: { type: "string" },
              },
            },
          },
        },
      },
      render,
    },
    timeoutMs: 60_000,
    async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
      const result = await options.runtime.diffSpreadsheets(
        args as unknown as SpreadsheetDiffInput,
        requireDocumentScope(exec, options),
      );
      const changes = result.changes.map((change) =>
        change.kind === "cell"
          ? {
              ...change,
              before: wireCell(change.before),
              after: wireCell(change.after),
            }
          : change.kind === "sheet_order"
            ? {
                ...change,
                beforeOrder: [...change.beforeOrder],
                afterOrder: [...change.afterOrder],
              }
            : { ...change },
      );
      return {
        ...result,
        sheets: [...result.sheets],
        warnings: [...result.warnings],
        changes,
      };
    },
  });
}
