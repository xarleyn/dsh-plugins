import type ExcelJS from "exceljs";
import { sha256Hex } from "../artifacts/store.js";
import { readZipEntries, readZipEntry } from "../inspect/zip.js";
import {
  withExtractionSlot,
  type DocumentRuntimeDeps,
} from "../orchestrator/runtime-deps.js";
import type { DocumentScope } from "../orchestrator/scope.js";
import { loadWorkbook, sheetInfo } from "./workbook.js";
import { checkSignal, invalid } from "./guards.js";
import {
  booleanOption,
  canonical,
  chooseSheets,
  cells,
  orderedAddresses,
  fullCell,
  preview,
  selectionRange,
  paginate,
} from "./query-shared.js";
import type {
  SpreadsheetChange,
  SpreadsheetDiffInput,
  SpreadsheetDiffResult,
  SpreadsheetSheetSummary,
} from "./query-types.js";

function summary(
  sheet: ExcelJS.Worksheet | undefined,
): SpreadsheetSheetSummary | undefined {
  if (!sheet) return undefined;
  const { mergedRanges, ...info } = sheetInfo(sheet);
  return {
    ...info,
    mergedRangeCount: mergedRanges.length,
    mergedRangesSha256: sha256Hex(canonical([...mergedRanges].sort())),
  };
}
function formatting(cell: ExcelJS.Cell | undefined): string {
  const value = cell?.value;
  return canonical({
    style: cell?.style ?? {},
    richText:
      value !== null && typeof value === "object" && "richText" in value
        ? value.richText
        : undefined,
  });
}
function partHashes(bytes: Buffer, signal?: AbortSignal): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of readZipEntries(bytes) ?? []) {
    checkSignal(signal);
    if (entry.name.endsWith("/")) continue;
    const data = readZipEntry(bytes, entry);
    if (!data) invalid("Cannot compare an unreadable XLSX part");
    result.set(entry.name, sha256Hex(data));
  }
  return result;
}
export async function diffSpreadsheets(
  deps: DocumentRuntimeDeps,
  input: SpreadsheetDiffInput,
  scope: DocumentScope,
): Promise<SpreadsheetDiffResult> {
  return withExtractionSlot(deps, scope.signal, async () => {
    const compareCachedResults = booleanOption(
      input.compareCachedResults,
      false,
      "compareCachedResults",
    );
    const compareFormatting = booleanOption(
      input.compareFormatting,
      false,
      "compareFormatting",
    );
    const packageRequested = booleanOption(
      input.comparePackageParts,
      false,
      "comparePackageParts",
    );
    const range = selectionRange(input.range);
    const before = await loadWorkbook(
      deps,
      {
        file: input.before,
        ...(input.beforeFormat === undefined
          ? {}
          : { format: input.beforeFormat }),
        ...(input.beforeText === undefined ? {} : { text: input.beforeText }),
      },
      scope,
    );
    const after = await loadWorkbook(
      deps,
      {
        file: input.after,
        ...(input.afterFormat === undefined
          ? {}
          : { format: input.afterFormat }),
        ...(input.afterText === undefined ? {} : { text: input.afterText }),
      },
      scope,
    );
    if (
      packageRequested &&
      (before.format !== "xlsx" || after.format !== "xlsx")
    )
      invalid("comparePackageParts requires two XLSX workbooks");
    const available = [
      ...new Set(
        [...before.workbook.worksheets, ...after.workbook.worksheets].map(
          (s) => s.name,
        ),
      ),
    ];
    const sheets = chooseSheets(available, input.sheets);
    let totalCellChanges = 0,
      totalSheetChanges = 0,
      totalPackageChanges = 0;
    function* entries(): Generator<SpreadsheetChange> {
      const beforeOrder = before.workbook.worksheets
        .map((s) => s.name)
        .filter((n) => sheets.includes(n));
      const afterOrder = after.workbook.worksheets
        .map((s) => s.name)
        .filter((n) => sheets.includes(n));
      // Added/deleted sheets already have individual records; report reorder only for common sheets.
      const commonBefore = beforeOrder.filter((n) => afterOrder.includes(n)),
        commonAfter = afterOrder.filter((n) => beforeOrder.includes(n));
      if (canonical(commonBefore) !== canonical(commonAfter)) {
        totalSheetChanges++;
        yield {
          kind: "sheet_order",
          beforeOrder: commonBefore,
          afterOrder: commonAfter,
        };
      }
      for (const name of sheets) {
        checkSignal(scope.signal);
        const a = before.workbook.getWorksheet(name),
          b = after.workbook.getWorksheet(name);
        const first = summary(a),
          second = summary(b);
        if (canonical(first) !== canonical(second)) {
          totalSheetChanges++;
          yield {
            kind: "sheet",
            sheet: name,
            ...(first ? { before: first } : {}),
            ...(second ? { after: second } : {}),
          };
        }
        const left = cells(a, range, scope.signal),
          right = cells(b, range, scope.signal);
        for (const address of orderedAddresses(left, right)) {
          checkSignal(scope.signal);
          const old = fullCell(left.get(address), address),
            next = fullCell(right.get(address), address);
          const formulaChanged = old.formula !== next.formula,
            typeChanged = old.type !== next.type,
            hyperlinkChanged = old.hyperlink !== next.hyperlink;
          const valueChanged =
            (!(old.type === "formula" && next.type === "formula") ||
              compareCachedResults) &&
            old.value !== next.value;
          const formattingChanged =
            compareFormatting &&
            formatting(left.get(address)) !== formatting(right.get(address));
          if (
            valueChanged ||
            formulaChanged ||
            typeChanged ||
            hyperlinkChanged ||
            formattingChanged
          ) {
            totalCellChanges++;
            yield {
              kind: "cell",
              sheet: name,
              address,
              before: preview(old),
              after: preview(next),
              valueChanged,
              formulaChanged,
              typeChanged,
              hyperlinkChanged,
              formattingChanged,
            };
          }
        }
      }
      if (packageRequested) {
        const left = partHashes(before.bytes, scope.signal),
          right = partHashes(after.bytes, scope.signal);
        for (const part of [
          ...new Set([...left.keys(), ...right.keys()]),
        ].sort()) {
          if (left.get(part) !== right.get(part)) {
            totalPackageChanges++;
            yield {
              kind: "package_part",
              part,
              ...(left.has(part) ? { beforeSha256: left.get(part)! } : {}),
              ...(right.has(part) ? { afterSha256: right.get(part)! } : {}),
            };
          }
        }
      }
    }
    const source = (loaded: typeof before) => ({
      filename: loaded.filename,
      sha256: loaded.sha256,
      format: loaded.format,
    });
    const header = {
      before: source(before),
      after: source(after),
      sheets,
      compareCachedResults,
      compareFormatting,
      packagePartsCompared: packageRequested,
      warnings: [
        ...new Set([...before.warnings, ...after.warnings]),
        "Cell previews are bounded; equality uses full values. Formula caches are never recalculated. Sheet metadata covers whole selected sheets; optional package hashes cover the whole XLSX package.",
        ...(packageRequested
          ? []
          : [
              "Charts, images and other package parts are not compared unless comparePackageParts is true.",
            ]),
      ],
    };
    const page = paginate(
      entries(),
      input,
      {
        before: before.sha256,
        after: after.sha256,
        beforeFormat: before.format,
        afterFormat: after.format,
        beforeText: "text" in before ? before.text : null,
        afterText: "text" in after ? after.text : null,
        sheets,
        range,
        compareCachedResults,
        compareFormatting,
        packageRequested,
      },
      deps.config.extraction.maxInlineChars,
      header,
    );
    return {
      ...header,
      changes: page.items,
      totalChanges: page.total,
      totalCellChanges,
      totalSheetChanges,
      totalPackageChanges,
      nextCursor: page.nextCursor,
    };
  });
}
