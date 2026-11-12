import type {
  SpreadsheetCell,
  SpreadsheetInspectInput,
  SpreadsheetSheetInfo,
} from "./types.js";

export interface SpreadsheetSelection {
  readonly sheets?: readonly string[];
  /** Inclusive A1 rectangle; applies to cell search/comparison, not package parts. */
  readonly range?: string;
  readonly limit?: number;
  readonly cursor?: string;
}
export interface SpreadsheetFindInput
  extends SpreadsheetInspectInput, SpreadsheetSelection {
  readonly query: string;
  readonly match?: "contains" | "exact";
  readonly caseSensitive?: boolean;
  readonly searchIn?: "value" | "formula" | "either";
}
export interface SpreadsheetCellPreview extends SpreadsheetCell {
  readonly truncatedFields: readonly string[];
}
export interface SpreadsheetSource {
  readonly filename: string;
  readonly sha256: string;
  readonly format: string;
}
export interface SpreadsheetFindResult {
  readonly source: SpreadsheetSource;
  readonly sheets: readonly string[];
  readonly matches: readonly {
    readonly sheet: string;
    readonly cell: SpreadsheetCellPreview;
    readonly matchedIn: readonly string[];
  }[];
  readonly totalMatches: number;
  readonly nextCursor: string | null;
  readonly warnings: readonly string[];
}
export interface SpreadsheetDiffInput extends SpreadsheetSelection {
  readonly before: string;
  readonly after: string;
  readonly beforeFormat?: SpreadsheetInspectInput["format"];
  readonly afterFormat?: SpreadsheetInspectInput["format"];
  readonly beforeText?: SpreadsheetInspectInput["text"];
  readonly afterText?: SpreadsheetInspectInput["text"];
  readonly compareCachedResults?: boolean;
  readonly compareFormatting?: boolean;
  readonly comparePackageParts?: boolean;
}
export interface SpreadsheetSheetSummary extends Omit<
  SpreadsheetSheetInfo,
  "mergedRanges"
> {
  readonly mergedRangeCount: number;
  readonly mergedRangesSha256: string;
}
export type SpreadsheetChange =
  | {
      readonly kind: "cell";
      readonly sheet: string;
      readonly address: string;
      readonly before: SpreadsheetCellPreview;
      readonly after: SpreadsheetCellPreview;
      readonly valueChanged: boolean;
      readonly formulaChanged: boolean;
      readonly typeChanged: boolean;
      readonly hyperlinkChanged: boolean;
      readonly formattingChanged: boolean;
    }
  | {
      readonly kind: "sheet";
      readonly sheet: string;
      readonly before?: SpreadsheetSheetSummary;
      readonly after?: SpreadsheetSheetSummary;
    }
  | {
      readonly kind: "sheet_order";
      readonly beforeOrder: readonly string[];
      readonly afterOrder: readonly string[];
    }
  | {
      readonly kind: "package_part";
      readonly part: string;
      readonly beforeSha256?: string;
      readonly afterSha256?: string;
    };
export interface SpreadsheetDiffResult {
  readonly before: SpreadsheetSource;
  readonly after: SpreadsheetSource;
  readonly sheets: readonly string[];
  readonly compareCachedResults: boolean;
  readonly compareFormatting: boolean;
  readonly packagePartsCompared: boolean;
  readonly changes: readonly SpreadsheetChange[];
  readonly totalChanges: number;
  readonly totalCellChanges: number;
  readonly totalSheetChanges: number;
  readonly totalPackageChanges: number;
  readonly nextCursor: string | null;
  readonly warnings: readonly string[];
}
