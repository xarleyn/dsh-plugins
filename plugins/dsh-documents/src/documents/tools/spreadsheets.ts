import {
  defineTool,
  type ValueSchemaSpec,
  type ParameterPropertySpec,
} from "@deepseek-ai/dsh-tools";
import {
  ARTIFACT_NOTE,
  formatBytes,
  fileParameter,
  requireDocumentScope,
  workspacePathName,
  type DocumentToolExec,
  type DocumentToolOptions,
} from "./shared.js";
import type {
  SpreadsheetCreateInput,
  SpreadsheetReadInput,
  SpreadsheetSheetInfo,
  SpreadsheetInspectInput,
} from "../spreadsheets/types.js";
import { SPREADSHEET_FORMATS } from "../spreadsheets/formats.js";

export const SPREADSHEET_TOOL_NAMES = [
  "spreadsheet_inspect",
  "spreadsheet_read",
  "spreadsheet_create",
] as const;

const scalarSchema = {
  oneOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
  ],
} satisfies ValueSchemaSpec;
const cellInputSchema = {
  oneOf: [
    scalarSchema,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        formula: { type: "string", required: true },
        result: {
          oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        date: {
          type: "string",
          required: true,
          description:
            "ISO date or UTC timestamp, such as 2026-01-15 or 2026-01-15T12:00:00Z.",
        },
      },
    },
  ],
} satisfies ValueSchemaSpec;

const sheetSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", required: true },
    state: { type: "string", required: true },
    rows: { type: "integer", required: true },
    columns: { type: "integer", required: true },
    nonEmptyRows: { type: "integer", required: true },
    mergedRanges: { type: "array", items: { type: "string" }, required: true },
  },
} satisfies ValueSchemaSpec;
const warningsSchema = {
  type: "array",
  items: { type: "string" },
  required: true,
} satisfies ParameterPropertySpec;
const formatParameter = {
  type: "string",
  enum: SPREADSHEET_FORMATS,
  description:
    "xlsx, csv, tsv, ods or fods. Read: detected from container or extension; specify for extensionless text. Create: defaults to xlsx.",
} satisfies ParameterPropertySpec;
const textParameter = {
  type: "object",
  additionalProperties: false,
  properties: {
    delimiter: {
      type: "string",
      description:
        "CSV separator: comma, semicolon, tab or pipe. Auto-detected on read. TSV always uses tab.",
    },
    encoding: {
      type: "string",
      enum: ["utf-8", "utf-16le", "utf-16be", "windows-1251"],
      description:
        "BOM is detected; default UTF-8. Set windows-1251 explicitly for legacy text.",
    },
  },
} satisfies ParameterPropertySpec;
const textOutput = {
  type: "object",
  additionalProperties: false,
  properties: {
    delimiter: { type: "string", required: true },
    encoding: { type: "string", required: true },
  },
} satisfies ParameterPropertySpec;
const cellSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    address: { type: "string", required: true },
    value: { ...scalarSchema, required: true },
    type: { type: "string", required: true },
    formula: { type: "string" },
    numberFormat: { type: "string" },
    hyperlink: { type: "string" },
  },
} satisfies ValueSchemaSpec;

function renderJson(_args: unknown, value: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(value) }];
}

function toolSheet(sheet: SpreadsheetSheetInfo) {
  return { ...sheet, mergedRanges: [...sheet.mergedRanges] };
}

export function createSpreadsheetTools(options: DocumentToolOptions) {
  return [
    defineTool({
      name: SPREADSHEET_TOOL_NAMES[0],
      description:
        "Inspect XLSX, CSV, TSV, ODS or FODS and list sheets, dimensions and merged ranges. CSV/TSV have one sheet named Data, with string values; delimiter and encoding are reported. Start here and use exact sheet names with spreadsheet_read. Legacy XLS and encrypted/macro workbooks are unsupported.",
      parameters: {
        file: fileParameter(),
        format: formatParameter,
        text: textParameter,
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            filename: { type: "string", required: true },
            format: { type: "string", required: true },
            text: textOutput,
            size: { type: "integer", required: true },
            sha256: { type: "string", required: true },
            sheets: { type: "array", items: sheetSchema, required: true },
            warnings: warningsSchema,
          },
        },
        render: renderJson,
      },
      timeoutMs: 60_000,
      async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
        const result = await options.runtime.inspectSpreadsheet(
          args as unknown as SpreadsheetInspectInput,
          requireDocumentScope(exec, options),
        );
        return {
          ...result,
          sheets: result.sheets.map(toolSheet),
          warnings: [...result.warnings],
        };
      },
    }),
    defineTool({
      name: SPREADSHEET_TOOL_NAMES[1],
      description:
        "Read a bounded page of XLSX, ODS, FODS, CSV or TSV with cell addresses. Choose an exact sheet from spreadsheet_inspect (Data for CSV/TSV), and reuse its text delimiter/encoding. CSV/TSV values stay strings, preserving leading zeroes; blank fields are empty strings. Defaults to 100 rows and 20 columns; at most 2000 cells per call. Follow nextRow for this column window, then nextColumn resetting the row. Formula results are saved caches, never recalculated.",
      parameters: {
        file: fileParameter(),
        format: formatParameter,
        text: textParameter,
        sheet: {
          type: "string",
          required: true,
          description: "Exact worksheet name from spreadsheet_inspect.",
        },
        startRow: {
          type: "integer",
          description: "First row, 1-based. Default 1.",
        },
        rowCount: {
          type: "integer",
          description: "Maximum rows in this page. Default 100.",
        },
        startColumn: {
          type: "integer",
          description: "First column, 1-based (A=1). Default 1.",
        },
        columnCount: {
          type: "integer",
          description: "Maximum columns in this window. Default 20.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            format: { type: "string", required: true },
            text: textOutput,
            filename: { type: "string", required: true },
            sha256: { type: "string", required: true },
            sheet: { ...sheetSchema, required: true },
            startRow: { type: "integer", required: true },
            startColumn: { type: "integer", required: true },
            rows: {
              type: "array",
              required: true,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  row: { type: "integer", required: true },
                  cells: { type: "array", items: cellSchema, required: true },
                },
              },
            },
            nextRow: {
              oneOf: [{ type: "integer" }, { type: "null" }],
              required: true,
            },
            nextColumn: {
              oneOf: [{ type: "integer" }, { type: "null" }],
              required: true,
            },
            warnings: warningsSchema,
          },
        },
        render: renderJson,
      },
      timeoutMs: 60_000,
      async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
        const result = await options.runtime.readSpreadsheet(
          args as unknown as SpreadsheetReadInput,
          requireDocumentScope(exec, options),
        );
        return {
          ...result,
          sheet: toolSheet(result.sheet),
          rows: result.rows.map((row) => ({
            row: row.row,
            cells: [...row.cells],
          })),
          warnings: [...result.warnings],
        };
      },
    }),
    defineTool({
      name: SPREADSHEET_TOOL_NAMES[2],
      description:
        "Create a spreadsheet artifact: XLSX by default, or CSV, TSV, ODS, FODS. XLSX/ODS/FODS allow many named sheets; CSV/TSV require exactly one. Typed input rows contain strings, numbers, booleans, null, dates or formula cells. CSV/TSV reject formula cells and export text, with formula-trigger strings escaped by default (text.escapeFormulas=false preserves them verbatim). ODS/FODS formulas require OpenFormula syntax such as of:=SUM([.B2:.B3]). Headers/filters/frozen rows/widths apply to XLSX only. Returns a file and manifest; no external programs required.",
      parameters: {
        format: formatParameter,
        text: {
          ...textParameter,
          properties: {
            ...textParameter.properties,
            bom: {
              type: "boolean",
              description:
                "Write a Unicode BOM. Default true; not used for windows-1251.",
            },
            escapeFormulas: {
              type: "boolean",
              description:
                "CSV/TSV: prefix formula-trigger strings with an apostrophe, default true. False exports them verbatim; spreadsheet applications may execute them.",
            },
          },
        },
        filename: {
          type: "string",
          description:
            "Workbook filename; directories are removed and the selected format extension is enforced.",
        },
        sheets: {
          type: "array",
          required: true,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: {
                type: "string",
                required: true,
                description: "Unique worksheet name, at most 31 characters.",
              },
              rows: {
                type: "array",
                required: true,
                items: { type: "array", items: cellInputSchema },
              },
              headerRow: {
                type: "boolean",
                description:
                  "Bold first row, enable filters and freeze it by default.",
              },
              freezeRows: {
                type: "integer",
                description: "Number of top rows to freeze.",
              },
              columnWidths: { type: "array", items: { type: "number" } },
            },
          },
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            artifactId: { type: "string", required: true },
            manifestPath: { type: "string", required: true },
            files: {
              type: "array",
              required: true,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  format: { type: "string", required: true },
                  path: { type: "string", required: true },
                  mediaType: { type: "string", required: true },
                  size: { type: "integer", required: true },
                  sha256: { type: "string", required: true },
                  status: { type: "string", required: true },
                },
              },
            },
            sheets: { type: "array", items: sheetSchema, required: true },
            warnings: warningsSchema,
          },
        },
        render: (_args: unknown, value: unknown) => [
          {
            type: "text" as const,
            text: [
              ...(
                value as {
                  files: {
                    format: string;
                    path: string;
                    size: number;
                    sha256: string;
                  }[];
                }
              ).files.map(
                (file) =>
                  `${file.format}: ${file.path} (${formatBytes(file.size)}, sha256 ${file.sha256.slice(0, 16)}…)`,
              ),
              JSON.stringify(value, null, 2),
              ARTIFACT_NOTE,
            ].join("\n"),
          },
        ],
      },
      timeoutMs: 60_000,
      async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
        const scope = requireDocumentScope(exec, options);
        await options.authorizeRender?.(scope);
        const result = await options.runtime.createSpreadsheet(
          args as unknown as SpreadsheetCreateInput,
          scope,
        );
        const fileName = async (target: string) => {
          const name = await workspacePathName(scope.workspaceRoot, target);
          // A pinned artifact root accepts root-relative bundle members as input.
          return name.includes("/") ? name : `${result.artifactId}/${name}`;
        };
        return {
          ...result,
          sheets: result.sheets.map(toolSheet),
          warnings: [...result.warnings],
          files: await Promise.all(
            result.files.map(async (file) => ({
              ...file,
              path: await fileName(file.path),
            })),
          ),
          manifestPath: await fileName(result.manifestPath),
        };
      },
    }),
  ];
}
