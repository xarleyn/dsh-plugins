import type { DocumentRuntimeDeps } from "../orchestrator/runtime-deps.js";
import { withExtractionSlot } from "../orchestrator/runtime-deps.js";
import type { DocumentScope } from "../orchestrator/scope.js";
import { loadWorkbook, cellInfo } from "./workbook.js";
import {
  invalid,
  checkSignal,
  SPREADSHEET_LIMITS as limits,
} from "./guards.js";
import {
  chooseSheets,
  selectionRange,
  booleanOption,
  cells,
  orderedAddresses,
  preview,
  paginate,
} from "./query-shared.js";
import type {
  SpreadsheetFindInput,
  SpreadsheetFindResult,
} from "./query-types.js";

export async function findSpreadsheet(
  deps: DocumentRuntimeDeps,
  input: SpreadsheetFindInput,
  scope: DocumentScope,
): Promise<SpreadsheetFindResult> {
  return withExtractionSlot(deps, scope.signal, async () => {
    if (
      typeof input.query !== "string" ||
      !input.query.length ||
      input.query.length > limits.cellChars
    )
      invalid(
        "query must be nonempty text within the cell character limit; use spreadsheet_read to inspect blank cells",
      );
    const match = input.match ?? "contains",
      searchIn = input.searchIn ?? "value";
    if (
      !["contains", "exact"].includes(match) ||
      !["value", "formula", "either"].includes(searchIn)
    )
      invalid("Invalid match or searchIn option");
    const caseSensitive = booleanOption(
      input.caseSensitive,
      false,
      "caseSensitive",
    );
    const range = selectionRange(input.range);
    const loaded = await loadWorkbook(deps, input, scope);
    const sheets = chooseSheets(
      loaded.workbook.worksheets.map((s) => s.name),
      input.sheets,
    );
    const normalize = (value: string) =>
      caseSensitive ? value : value.toLowerCase();
    const query = normalize(input.query);
    const matches = (value: string) =>
      match === "exact"
        ? normalize(value) === query
        : normalize(value).includes(query);
    function* entries(): Generator<SpreadsheetFindResult["matches"][number]> {
      for (const name of sheets) {
        const map = cells(
          loaded.workbook.getWorksheet(name),
          range,
          scope.signal,
        );
        for (const address of orderedAddresses(map)) {
          checkSignal(scope.signal);
          const cell = cellInfo(map.get(address)!);
          const matchedIn: string[] = [];
          if (
            searchIn !== "formula" &&
            cell.value !== null &&
            matches(String(cell.value))
          )
            matchedIn.push("value");
          if (
            searchIn !== "value" &&
            cell.formula !== undefined &&
            matches(cell.formula)
          )
            matchedIn.push("formula");
          if (matchedIn.length)
            yield { sheet: name, cell: preview(cell), matchedIn };
        }
      }
    }
    const source = {
      filename: loaded.filename,
      sha256: loaded.sha256,
      format: loaded.format,
    };
    const warnings = [
      ...loaded.warnings,
      "Matches contain bounded previews. Read original cells before copying values; truncatedFields identifies shortened text. Merged slave cells are not separate matches.",
    ];
    const header = { source, sheets, warnings };
    const page = paginate(
      entries(),
      input,
      {
        sha256: loaded.sha256,
        format: loaded.format,
        text: "text" in loaded ? loaded.text : null,
        sheets,
        range,
        query: input.query,
        match,
        searchIn,
        caseSensitive,
      },
      deps.config.extraction.maxInlineChars,
      header,
    );
    return {
      ...header,
      matches: page.items,
      totalMatches: page.total,
      nextCursor: page.nextCursor,
    };
  });
}
