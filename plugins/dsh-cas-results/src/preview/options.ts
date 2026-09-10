/**
 * Shared preview option contract (SPEC §18, §23).
 */

export interface PreviewOptions {
  /** Total character budget for the preview body (marker excluded). */
  maxChars: number;
  keepHeadLines: number;
  keepTailLines: number;
  /** Case-insensitive substrings kept from the middle of logs. */
  keepPatterns: readonly string[];
}
