import path from "node:path";
import { DocumentError } from "../errors.js";
import type { DocumentRuntimeDeps } from "../orchestrator/runtime-deps.js";
import { withRenderSlot } from "../orchestrator/runtime-deps.js";
import {
  ensureArtifactRoot,
  resolveDocumentScope,
  type DocumentScope,
} from "../orchestrator/scope.js";
import { sanitizeFilename } from "../security/paths.js";
import { createCell, loadWorkbook, sheetInfo } from "./workbook.js";
import { editXlsx, type CellEdit } from "./edit-xlsx.js";
import { encodeWorkbook, spreadsheetMediaType } from "./formats.js";
import {
  checkSignal,
  invalid,
  tooLarge,
  SPREADSHEET_LIMITS as limits,
} from "./guards.js";
import type {
  SpreadsheetEditInput,
  SpreadsheetEditResult,
  SpreadsheetCellInput,
} from "./types.js";

export async function editSpreadsheet(
  deps: DocumentRuntimeDeps,
  input: SpreadsheetEditInput,
  scope: DocumentScope,
): Promise<SpreadsheetEditResult> {
  return withRenderSlot(deps, scope.signal, async () => {
    checkSignal(scope.signal);
    if (!/^[a-f0-9]{64}$/u.test(input.expectedSha256 ?? ""))
      invalid(
        "expectedSha256 must be the SHA-256 from spreadsheet_inspect or spreadsheet_read",
      );
    if (
      !Array.isArray(input.edits) ||
      input.edits.length === 0 ||
      input.edits.length > limits.pageCells
    )
      invalid(
        "edits must be a nonempty array within the 2000-cell edit budget",
      );
    if (input.filename !== undefined && typeof input.filename !== "string")
      invalid("filename must be a string");
    if (
      Buffer.byteLength(JSON.stringify(input)) >
      deps.config.limits.maxInputBytes
    )
      tooLarge("Edit request exceeds limits.maxInputBytes");
    const loaded = await loadWorkbook(deps, input, scope);
    if (loaded.sha256 !== input.expectedSha256)
      invalid("Source changed: inspect and read again before editing");
    if (loaded.format === "ods" || loaded.format === "fods")
      throw new DocumentError(
        "UNSUPPORTED_FORMAT",
        "Editing ODS/FODS is unsupported; recreating these formats would lose original styles and objects",
      );
    const edits: CellEdit[] = [];
    const seen = new Set<string>();
    for (const block of input.edits) {
      checkSignal(scope.signal);
      if (
        !block ||
        typeof block.sheet !== "string" ||
        !/^[A-Z]{1,3}[1-9][0-9]*$/u.test(block.startCell ?? "")
      )
        invalid("Each edit requires an exact sheet and an A1 startCell");
      if (
        block.onlyIfBlank !== undefined &&
        typeof block.onlyIfBlank !== "boolean"
      )
        invalid("onlyIfBlank must be boolean");
      const sheet = loaded.workbook.worksheets.find(
        (s) => s.name === block.sheet,
      );
      if (!sheet)
        invalid("Worksheet not found; inspect exact sheet names first");
      if (
        !Array.isArray(block.rows) ||
        block.rows.length === 0 ||
        block.rows.length > limits.pageCells
      )
        invalid("Edit rows must be a nonempty bounded array");
      const startRow = Number(block.startCell.replace(/[A-Z]/gu, ""));
      const startColumn = [...block.startCell.replace(/[0-9]/gu, "")].reduce(
        (n, c) => n * 26 + c.charCodeAt(0) - 64,
        0,
      );
      for (const [r, row] of block.rows.entries()) {
        if (
          !Array.isArray(row) ||
          row.length === 0 ||
          row.length > limits.pageCells
        )
          invalid(
            "Each edit row must contain values; use null to clear a cell",
          );
        for (const [c, original] of row.entries()) {
          const number = startRow + r,
            column = startColumn + c;
          if (number > limits.rows || column > limits.columns)
            tooLarge("Edit coordinates exceed the workbook budget");
          if (edits.length >= limits.pageCells)
            tooLarge("At most 2000 cells may be edited per call");
          const cell = sheet.getCell(number, column);
          const key = JSON.stringify([sheet.name, cell.address]);
          if (seen.has(key))
            invalid("Edit blocks overlap; write each cell only once");
          seen.add(key);
          if (block.onlyIfBlank && cell.value !== null && cell.value !== "")
            invalid(
              "onlyIfBlank refused an occupied cell; no artifact was created",
            );
          if (
            loaded.format !== "xlsx" &&
            original !== null &&
            typeof original === "object" &&
            "formula" in original
          )
            invalid("CSV/TSV do not support formula cells");
          // Escape only newly supplied CSV text; retain untouched fields verbatim.
          const value =
            loaded.format !== "xlsx" &&
            typeof original === "string" &&
            /^(?:\s*[=+@＝＋－＠-]|[\t\r])/u.test(original)
              ? `'${original}`
              : original;
          cell.value = createCell(value);
          edits.push({
            sheet: sheet.name,
            address: cell.address,
            row: number,
            column,
            value,
          });
        }
      }
    }
    const bytes =
      loaded.format === "xlsx"
        ? await editXlsx(loaded.bytes, edits, scope.signal)
        : (
            await encodeWorkbook(
              loaded.workbook,
              {
                format: loaded.format,
                text: {
                  ...("text" in loaded ? loaded.text : {}),
                  escapeFormulas: false,
                },
                sheets: loaded.workbook.worksheets.map((sheet) => ({
                  name: sheet.name,
                  rows: Array.from({ length: sheet.rowCount }, (_, r) => {
                    const row = sheet.getRow(r + 1);
                    return Array.from({ length: row.cellCount }, (_, c) => {
                      const value = row.getCell(c + 1).value;
                      return value instanceof Date
                        ? { date: value.toISOString() }
                        : (value as SpreadsheetCellInput);
                    });
                  }),
                })),
              },
              scope.signal,
            )
          ).bytes;
    checkSignal(scope.signal);
    if (bytes.length > deps.config.limits.maxInputBytes)
      tooLarge("Edited workbook exceeds limits.maxInputBytes");
    const resolved = await resolveDocumentScope(deps.config, scope);
    await ensureArtifactRoot(resolved);
    const { artifactId } = await resolved.store.create(deps.now().getTime());
    const filename = sanitizeFilename(
      input.filename,
      `${path.parse(loaded.filename).name}-edited`,
      loaded.format,
    );
    const file = {
      ...(await resolved.store.write(`${artifactId}/${filename}`, bytes)),
      format: loaded.format,
      mediaType: spreadsheetMediaType(loaded.format),
      status: "created" as const,
    };
    const source = { filename: loaded.filename, sha256: loaded.sha256 };
    const warnings = [
      "Original input is unchanged; this is a new edited artifact.",
      "Formula and chart caches may be stale. No formulas were evaluated; XLSX requests full recalculation when opened.",
      ...(loaded.format === "xlsx"
        ? []
        : [
            "CSV/TSV quoting and line endings are normalized; formula-trigger strings in edited cells are escaped.",
          ]),
    ];
    const sheets = loaded.workbook.worksheets.map(sheetInfo);
    await resolved.store.write(
      `${artifactId}/edits.json`,
      JSON.stringify({ source, edits: input.edits }, null, 2),
    );
    const manifest = await resolved.store.write(
      `${artifactId}/manifest.json`,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "spreadsheet",
          artifactId,
          source,
          changedCells: edits.length,
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
      source,
      changedCells: edits.length,
      files: [file],
      manifestPath: manifest.path,
      sheets,
      warnings,
    };
  });
}
