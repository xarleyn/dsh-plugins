import { defineTool } from "@deepseek-ai/dsh-tools";
import type { cellInputSchema } from "./spreadsheets.js";
import {
  ARTIFACT_NOTE,
  fileParameter,
  formatBytes,
  requireDocumentScope,
  workspacePathName,
  type DocumentToolExec,
  type DocumentToolOptions,
} from "./shared.js";
import type { SpreadsheetEditInput } from "../spreadsheets/types.js";

export function createSpreadsheetEditTool(
  options: DocumentToolOptions,
  cellSchema: typeof cellInputSchema,
) {
  return defineTool({
    name: "spreadsheet_edit",
    description:
      "Edit existing XLSX, CSV or TSV into a NEW file; the source is never overwritten. Uploaded chat files can be used directly when admitted to this session; no file copy or shell is needed. Inspect/read first and pass the source sha256 as expectedSha256. Submit bounded rectangular edits on exact sheet names (at most 2000 cells total), with null to clear. XLSX preserves other package parts, styles and objects; shared/array formula ranges, merged non-anchor cells, protected sheets and signed/macro books are refused. Formulas are NOT calculated; saved caches may be stale. ODS/FODS editing is unsupported to avoid losing styles. Re-inspect the returned artifact and verify changed cells before delivering it.",
    parameters: {
      file: fileParameter(),
      expectedSha256: {
        type: "string",
        required: true,
        description:
          "SHA-256 returned by spreadsheet_inspect/read for the exact source version.",
      },
      filename: {
        type: "string",
        description:
          "Optional output filename, default source-name-edited with original extension. Always saved in a new artifact.",
      },
      format: {
        type: "string",
        enum: ["xlsx", "csv", "tsv"],
        description: "Optional input format hint for extensionless CSV/TSV.",
      },
      text: {
        type: "object",
        additionalProperties: false,
        properties: {
          delimiter: { type: "string" },
          encoding: {
            type: "string",
            enum: ["utf-8", "utf-16le", "utf-16be", "windows-1251"],
          },
        },
      },
      edits: {
        type: "array",
        required: true,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sheet: {
              type: "string",
              required: true,
              description: "Exact sheet name from inspect; Data for CSV/TSV.",
            },
            startCell: {
              type: "string",
              required: true,
              description: "Top-left A1 address, e.g. D5.",
            },
            rows: {
              type: "array",
              required: true,
              items: { type: "array", items: cellSchema },
            },
            onlyIfBlank: {
              type: "boolean",
              description:
                "If true, refuse the entire operation if any target is occupied. Formula cells count as occupied.",
            },
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
          changedCells: { type: "integer", required: true },
          source: {
            type: "object",
            additionalProperties: false,
            required: true,
            properties: {
              filename: { type: "string", required: true },
              sha256: { type: "string", required: true },
            },
          },
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
          sheets: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", required: true },
                state: { type: "string", required: true },
                rows: { type: "integer", required: true },
                columns: { type: "integer", required: true },
                nonEmptyRows: { type: "integer", required: true },
                mergedRanges: {
                  type: "array",
                  items: { type: "string" },
                  required: true,
                },
              },
            },
          },
          warnings: {
            type: "array",
            items: { type: "string" },
            required: true,
          },
        },
      },
      render: (_args: unknown, value: unknown) => {
        const result = value as {
          files: {
            format: string;
            path: string;
            size: number;
            sha256: string;
          }[];
        };
        return [
          {
            type: "text" as const,
            text: [
              ...result.files.map(
                (file) =>
                  `${file.format}: ${file.path} (${formatBytes(file.size)}, sha256 ${file.sha256.slice(0, 16)}…)`,
              ),
              JSON.stringify(value, null, 2),
              ARTIFACT_NOTE,
            ].join("\n"),
          },
        ];
      },
    },
    timeoutMs: 60_000,
    async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
      const scope = requireDocumentScope(exec, options);
      await options.authorizeRender?.(scope);
      const result = await options.runtime.editSpreadsheet(
        args as unknown as SpreadsheetEditInput,
        scope,
      );
      const fileName = async (target: string) => {
        const name = await workspacePathName(scope.workspaceRoot, target);
        return name.includes("/") ? name : `${result.artifactId}/${name}`;
      };
      return {
        ...result,
        sheets: result.sheets.map((sheet) => ({
          ...sheet,
          mergedRanges: [...sheet.mergedRanges],
        })),
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
  });
}
