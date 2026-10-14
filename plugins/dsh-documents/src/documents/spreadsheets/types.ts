/** Spreadsheet contracts. Formula results are cached values, never evaluated here. */
export type SpreadsheetFormat = "xlsx" | "csv" | "tsv" | "ods" | "fods";
export type SpreadsheetEncoding =
  "utf-8" | "utf-16le" | "utf-16be" | "windows-1251";
export interface SpreadsheetTextOptions {
  readonly delimiter?: string;
  readonly encoding?: SpreadsheetEncoding;
}
export interface SpreadsheetInspectInput {
  readonly file: string;
  readonly format?: SpreadsheetFormat;
  readonly text?: SpreadsheetTextOptions;
}
export type SpreadsheetScalar = string | number | boolean | null;
export type SpreadsheetCellInput =
  | SpreadsheetScalar
  | {
      readonly formula: string;
      readonly result?: string | number | boolean;
    }
  | { readonly date: string };

export interface SpreadsheetSheetInput {
  readonly name: string;
  readonly rows: readonly (readonly SpreadsheetCellInput[])[];
  readonly headerRow?: boolean;
  readonly freezeRows?: number;
  readonly columnWidths?: readonly number[];
}

export interface SpreadsheetCreateInput {
  readonly format?: SpreadsheetFormat;
  readonly text?: SpreadsheetTextOptions & {
    readonly bom?: boolean;
    readonly escapeFormulas?: boolean;
  };
  readonly filename?: string;
  readonly sheets: readonly SpreadsheetSheetInput[];
}

export interface SpreadsheetReadInput extends SpreadsheetInspectInput {
  /** Exact name from spreadsheet_inspect; never silently selects the first sheet. */
  readonly sheet: string;
  readonly startRow?: number;
  readonly rowCount?: number;
  readonly startColumn?: number;
  readonly columnCount?: number;
}

export interface SpreadsheetSheetInfo {
  readonly name: string;
  readonly state: string;
  readonly rows: number;
  readonly columns: number;
  readonly nonEmptyRows: number;
  readonly mergedRanges: readonly string[];
}

export interface SpreadsheetCell {
  readonly address: string;
  readonly value: SpreadsheetScalar;
  readonly type:
    "blank" | "string" | "number" | "boolean" | "date" | "formula" | "error";
  readonly formula?: string;
  readonly numberFormat?: string;
  readonly hyperlink?: string;
}

export interface SpreadsheetInspectResult {
  readonly filename: string;
  readonly format: SpreadsheetFormat;
  readonly text?: {
    readonly delimiter: string;
    readonly encoding: SpreadsheetEncoding;
  };
  readonly size: number;
  readonly sha256: string;
  readonly sheets: readonly SpreadsheetSheetInfo[];
  readonly warnings: readonly string[];
}

export interface SpreadsheetReadResult {
  readonly format: SpreadsheetFormat;
  readonly text?: {
    readonly delimiter: string;
    readonly encoding: SpreadsheetEncoding;
  };
  readonly filename: string;
  readonly sha256: string;
  readonly sheet: SpreadsheetSheetInfo;
  readonly startRow: number;
  readonly startColumn: number;
  readonly rows: readonly {
    readonly row: number;
    readonly cells: readonly SpreadsheetCell[];
  }[];
  readonly nextRow: number | null;
  readonly nextColumn: number | null;
  readonly warnings: readonly string[];
}

export interface SpreadsheetCreateResult {
  readonly artifactId: string;
  readonly files: readonly {
    readonly format: SpreadsheetFormat;
    readonly path: string;
    readonly size: number;
    readonly sha256: string;
    readonly mediaType: string;
    readonly status: "created";
  }[];
  readonly manifestPath: string;
  readonly sheets: readonly SpreadsheetSheetInfo[];
  readonly warnings: readonly string[];
}
