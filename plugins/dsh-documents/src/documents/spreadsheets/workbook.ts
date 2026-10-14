import ExcelJS from "exceljs";
import path from "node:path";
import { sha256Hex } from "../artifacts/store.js";
import {
  decodeWorkbook,
  encodeWorkbook,
  spreadsheetMediaType,
} from "./formats.js";
import type { DocumentRuntimeDeps } from "../orchestrator/runtime-deps.js";
import {
  withExtractionSlot,
  withRenderSlot,
} from "../orchestrator/runtime-deps.js";
import {
  ensureArtifactRoot,
  readInputBytes,
  resolveDocumentScope,
  resolveInputPath,
  type DocumentScope,
} from "../orchestrator/scope.js";
import { sanitizeFilename } from "../security/paths.js";
import {
  checkSignal,
  invalid,
  positiveInteger,
  SPREADSHEET_LIMITS as limits,
  tooLarge,
} from "./guards.js";
import type {
  SpreadsheetCell,
  SpreadsheetCellInput,
  SpreadsheetCreateInput,
  SpreadsheetCreateResult,
  SpreadsheetInspectResult,
  SpreadsheetInspectInput,
  SpreadsheetReadInput,
  SpreadsheetReadResult,
  SpreadsheetScalar,
  SpreadsheetSheetInfo,
} from "./types.js";

function sheetInfo(sheet: ExcelJS.Worksheet): SpreadsheetSheetInfo {
  return {
    name: sheet.name,
    state: sheet.state,
    rows: sheet.rowCount,
    columns: sheet.columnCount,
    nonEmptyRows: sheet.actualRowCount,
    mergedRanges: sheet.model.merges ?? [],
  };
}

async function loadWorkbook(
  deps: DocumentRuntimeDeps,
  input: SpreadsheetInspectInput,
  scope: DocumentScope,
) {
  if (typeof input.file !== "string")
    invalid("file must be a spreadsheet path");
  checkSignal(scope.signal);
  const resolved = await resolveDocumentScope(deps.config, scope);
  const inputPath = await resolveInputPath(
    deps.config,
    resolved,
    input.file,
    "workbook",
  );
  const bytes = await readInputBytes(
    inputPath,
    {
      ...deps.config,
      limits: {
        ...deps.config.limits,
        maxInputBytes: Math.min(
          deps.config.limits.maxInputBytes,
          limits.expandedBytes,
        ),
      },
    },
    "workbook",
  );
  const decoded = await decodeWorkbook(bytes, inputPath, input, scope.signal);
  const { workbook } = decoded;
  checkSignal(scope.signal);
  if (workbook.worksheets.length > limits.sheets)
    tooLarge("Workbook has too many sheets");
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > limits.rows || sheet.columnCount > limits.columns)
      tooLarge("Workbook dimensions exceed the supported budget");
  }
  return {
    ...decoded,
    workbook,
    filename: path.basename(inputPath),
    size: bytes.length,
    sha256: sha256Hex(bytes),
  };
}

export async function inspectSpreadsheet(
  deps: DocumentRuntimeDeps,
  input: SpreadsheetInspectInput,
  scope: DocumentScope,
): Promise<SpreadsheetInspectResult> {
  return withExtractionSlot(deps, scope.signal, async () => {
    const loaded = await loadWorkbook(deps, input, scope);
    const result: SpreadsheetInspectResult = {
      filename: loaded.filename,
      format: loaded.format,
      ...("text" in loaded ? { text: loaded.text } : {}),
      size: loaded.size,
      sha256: loaded.sha256,
      sheets: loaded.workbook.worksheets.map(sheetInfo),
      warnings: loaded.warnings,
    };
    if (JSON.stringify(result).length > deps.config.extraction.maxInlineChars)
      tooLarge("Workbook metadata exceeds extraction.maxInlineChars");
    return result;
  });
}

function scalar(value: unknown): SpreadsheetScalar {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return value.toISOString();
  if (value !== null && typeof value === "object" && "error" in value)
    return String(value.error);
  return null;
}

function cellInfo(cell: ExcelJS.Cell): SpreadsheetCell {
  const value = cell.value;
  const extra = cell.numFmt === undefined ? {} : { numberFormat: cell.numFmt };
  if (value === null)
    return { address: cell.address, value: null, type: "blank", ...extra };
  if (value instanceof Date)
    return {
      address: cell.address,
      value: scalar(value),
      type: "date",
      ...extra,
    };
  if (typeof value !== "object")
    return {
      address: cell.address,
      value: scalar(value),
      type: typeof value as "string" | "number" | "boolean",
      ...extra,
    };
  if ("formula" in value || "sharedFormula" in value)
    return {
      address: cell.address,
      value: scalar(cell.result),
      type: "formula",
      formula: cell.formula ?? "",
      ...extra,
    };
  if ("error" in value)
    return {
      address: cell.address,
      value: String(value.error),
      type: "error",
      ...extra,
    };
  if ("richText" in value)
    return {
      address: cell.address,
      value: value.richText.map((item) => item.text).join(""),
      type: "string",
      ...extra,
    };
  if ("hyperlink" in value)
    return {
      address: cell.address,
      value: value.text,
      type: "string",
      hyperlink: value.hyperlink,
      ...extra,
    };
  return { address: cell.address, value: cell.text, type: "string", ...extra };
}

export async function readSpreadsheet(
  deps: DocumentRuntimeDeps,
  input: SpreadsheetReadInput,
  scope: DocumentScope,
): Promise<SpreadsheetReadResult> {
  return withExtractionSlot(deps, scope.signal, async () => {
    if (typeof input.sheet !== "string" || input.sheet === "")
      invalid("sheet must be an exact worksheet name from spreadsheet_inspect");
    const startRow = positiveInteger(
      input.startRow,
      1,
      limits.rows,
      "startRow",
    );
    const rowCount = positiveInteger(
      input.rowCount,
      100,
      limits.rows,
      "rowCount",
    );
    const startColumn = positiveInteger(
      input.startColumn,
      1,
      limits.columns,
      "startColumn",
    );
    const columnCount = positiveInteger(
      input.columnCount,
      20,
      limits.columns,
      "columnCount",
    );
    if (rowCount * columnCount > limits.pageCells)
      invalid(
        "A read page may contain at most 2000 cells; reduce rowCount or columnCount",
      );
    const loaded = await loadWorkbook(deps, input, scope);
    const sheet = loaded.workbook.worksheets.find(
      (candidate) => candidate.name === input.sheet,
    );
    if (sheet === undefined)
      invalid(
        "Worksheet not found; use an exact name returned by spreadsheet_inspect",
      );
    const info = sheetInfo(sheet);
    const lastRow = Math.min(sheet.rowCount, startRow + rowCount - 1);
    const lastColumn = Math.min(
      sheet.columnCount,
      startColumn + columnCount - 1,
    );
    const maxChars = Math.min(deps.config.extraction.maxInlineChars, 100_000);
    const rows: { row: number; cells: SpreadsheetCell[] }[] = [];
    const warnings = [
      ...loaded.warnings,
      ...(info.mergedRanges.length > 0
        ? [
            "Merged cells repeat their master value; use mergedRanges to interpret the layout.",
          ]
        : []),
    ];
    const base = {
      format: loaded.format,
      ...("text" in loaded ? { text: loaded.text } : {}),
      filename: loaded.filename,
      sha256: loaded.sha256,
      sheet: info,
      startRow,
      startColumn,
      rows: [],
      nextRow: limits.rows,
      nextColumn: limits.columns,
      warnings,
    };
    let chars = JSON.stringify(base).length;
    if (chars > maxChars)
      tooLarge("Worksheet metadata exceeds the inline budget");
    for (
      let row = startRow;
      row <= lastRow && startColumn <= lastColumn;
      row += 1
    ) {
      checkSignal(scope.signal);
      const cells: SpreadsheetCell[] = [];
      for (let column = startColumn; column <= lastColumn; column += 1)
        cells.push(cellInfo(sheet.getCell(row, column)));
      const record = { row, cells };
      const size = JSON.stringify(record).length + (rows.length > 0 ? 1 : 0);
      if (chars + size > maxChars) {
        if (rows.length === 0)
          tooLarge(
            "One row exceeds the inline budget; read fewer columns or increase extraction.maxInlineChars",
          );
        break;
      }
      chars += size;
      rows.push(record);
    }
    const endRow = rows.at(-1)?.row ?? lastRow;
    return {
      format: loaded.format,
      ...("text" in loaded ? { text: loaded.text } : {}),
      filename: loaded.filename,
      sha256: loaded.sha256,
      sheet: info,
      startRow,
      startColumn,
      rows,
      nextRow: rows.length > 0 && endRow < sheet.rowCount ? endRow + 1 : null,
      nextColumn:
        startColumn <= lastColumn && lastColumn < sheet.columnCount
          ? lastColumn + 1
          : null,
      warnings,
    };
  });
}

function validateText(text: unknown, label: string): string {
  if (typeof text !== "string") invalid(`${label} must be a string`);
  if (text.length > limits.cellChars)
    tooLarge(`${label} exceeds the Excel cell character limit`);
  return text;
}

function createCell(value: SpreadsheetCellInput): ExcelJS.CellValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return validateText(value, "Cell text");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("Cell numbers must be finite");
    return value;
  }
  if (typeof value !== "object" || Array.isArray(value))
    invalid("Unsupported cell value");
  if ("formula" in value) {
    if (Object.keys(value).some((key) => !["formula", "result"].includes(key)))
      invalid("Formula cells accept only formula and result");
    const formula = validateText(value.formula, "Formula").replace(/^=/u, "");
    if (formula.trim() === "") invalid("Formula must not be empty");
    if (
      value.result !== undefined &&
      !["string", "number", "boolean"].includes(typeof value.result)
    )
      invalid("Formula result must be a string, number or boolean");
    if (typeof value.result === "number" && !Number.isFinite(value.result))
      invalid("Formula result must be finite");
    if (typeof value.result === "string")
      validateText(value.result, "Formula result");
    return {
      formula,
      ...(value.result === undefined ? {} : { result: value.result }),
    };
  }
  if ("date" in value && Object.keys(value).length === 1) {
    if (
      typeof value.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/u.test(
        value.date,
      )
    )
      invalid("Dates must be ISO dates or UTC timestamps");
    const date = new Date(value.date);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value.date.slice(0, 10)
    )
      invalid("Invalid date");
    return date;
  }
  invalid("Cell objects must contain a formula or an ISO date");
}

export async function createSpreadsheet(
  deps: DocumentRuntimeDeps,
  input: SpreadsheetCreateInput,
  scope: DocumentScope,
): Promise<SpreadsheetCreateResult> {
  return withRenderSlot(deps, scope.signal, async () => {
    checkSignal(scope.signal);
    if (
      !Array.isArray(input.sheets) ||
      input.sheets.length === 0 ||
      input.sheets.length > limits.sheets
    )
      invalid("sheets must contain between 1 and 128 worksheets");
    if (input.filename !== undefined && typeof input.filename !== "string")
      invalid("filename must be a string");
    const source = JSON.stringify(input);
    if (Buffer.byteLength(source) > deps.config.limits.maxInputBytes)
      tooLarge("Workbook source exceeds limits.maxInputBytes");
    const workbook = new ExcelJS.Workbook();
    workbook.calcProperties.fullCalcOnLoad = true;
    const names = new Set<string>();
    let cellCount = 0;
    for (const data of input.sheets) {
      checkSignal(scope.signal);
      if (
        data === null ||
        typeof data !== "object" ||
        typeof data.name !== "string" ||
        data.name.trim() === "" ||
        data.name.length > 31 ||
        /[\\/*?:[\]]/u.test(data.name) ||
        data.name.startsWith("'") ||
        data.name.endsWith("'")
      )
        invalid(
          "Sheet names must be nonblank, unique and at most 31 characters, without Excel's reserved characters",
        );
      const key = data.name.toLowerCase();
      if (names.has(key))
        invalid("Sheet names must be unique (case insensitive)");
      names.add(key);
      if (!Array.isArray(data.rows) || data.rows.length > limits.rows)
        invalid("rows must be an array within the 100000 row budget");
      if (data.headerRow !== undefined && typeof data.headerRow !== "boolean")
        invalid("headerRow must be boolean");
      const frozen =
        data.freezeRows === undefined
          ? data.headerRow
            ? 1
            : 0
          : data.freezeRows;
      if (!Number.isInteger(frozen) || frozen < 0 || frozen > limits.rows)
        invalid("freezeRows must be an integer between 0 and 100000");
      const sheet = workbook.addWorksheet(data.name);
      for (const row of data.rows) {
        if (!Array.isArray(row) || row.length > limits.columns)
          invalid("Each row must be an array within Excel's column limit");
        cellCount += row.length;
        if (cellCount > limits.cells)
          tooLarge("Workbook exceeds the 200000 cell budget");
        checkSignal(scope.signal);
        sheet.addRow(row.map(createCell));
      }
      if (data.headerRow && sheet.rowCount > 0) {
        sheet.getRow(1).font = { bold: true };
        if (sheet.columnCount > 0)
          sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: sheet.columnCount },
          };
      }
      if (frozen > 0) sheet.views = [{ state: "frozen", ySplit: frozen }];
      if (data.columnWidths !== undefined) {
        if (
          !Array.isArray(data.columnWidths) ||
          data.columnWidths.length > limits.columns
        )
          invalid("columnWidths must be an array within Excel's column limit");
        data.columnWidths.forEach((width: number, index: number) => {
          if (
            typeof width !== "number" ||
            !Number.isFinite(width) ||
            width < 1 ||
            width > 255
          )
            invalid("Column widths must be between 1 and 255");
          sheet.getColumn(index + 1).width = width;
        });
      }
    }
    const { bytes, format, warnings } = await encodeWorkbook(
      workbook,
      input,
      scope.signal,
    );
    checkSignal(scope.signal);
    if (bytes.length > deps.config.limits.maxInputBytes)
      tooLarge("Generated spreadsheet exceeds limits.maxInputBytes");
    const resolved = await resolveDocumentScope(deps.config, scope);
    await ensureArtifactRoot(resolved);
    const { artifactId } = await resolved.store.create(deps.now().getTime());
    const filename = sanitizeFilename(input.filename, "workbook", format);
    const file = {
      ...(await resolved.store.write(`${artifactId}/${filename}`, bytes)),
      format,
      mediaType: spreadsheetMediaType(format),
      status: "created" as const,
    };
    const sheets = workbook.worksheets.map(sheetInfo);
    await resolved.store.write(`${artifactId}/source.json`, source);
    const manifest = await resolved.store.write(
      `${artifactId}/manifest.json`,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "spreadsheet",
          artifactId,
          createdAt: deps.now().toISOString(),
          files: [{ ...file, path: filename }],
          sheets,
          warnings,
        },
        null,
        2,
      ),
    );
    return {
      artifactId,
      files: [file],
      manifestPath: manifest.path,
      sheets,
      warnings,
    };
  });
}
