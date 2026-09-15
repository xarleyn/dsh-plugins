import { requiredText } from "../../coerce.js";
import { IntegrationError } from "../../errors.js";

/**
 * Build logs are untrusted external text: they carry ANSI colouring, control
 * characters, commit messages written by anyone who can push, broken Unicode and
 * whatever a job decided to print. The provider hands the model a bounded,
 * cleaned window and never treats a line of it as an instruction.
 */
export type LogMode = "tail" | "head" | "search";

export const LOG_MODES: readonly LogMode[] = Object.freeze([
  "tail",
  "head",
  "search",
]);

/** Lines kept around each match in `search` mode. */
const SEARCH_CONTEXT = 2;

// Terminal control sequences are exactly what this module exists to strip, so
// the control characters in these patterns are the point rather than a slip.
/* eslint-disable no-control-regex */
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/gu;
const OSC = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu;
/* eslint-enable no-control-regex */

export function logMode(value: unknown): LogMode {
  const mode = value === undefined ? "tail" : requiredText(value, "mode", 3, 6);
  if (!LOG_MODES.includes(mode as LogMode)) {
    throw new IntegrationError("InvalidRequest", "mode is invalid");
  }
  return mode as LogMode;
}

export function logLines(value: unknown, maxLines: number): number {
  if (value === undefined) return Math.min(200, maxLines);
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new IntegrationError("InvalidRequest", "maxLines is invalid");
  }
  return Math.min(Number(value), maxLines);
}

/** Strip terminal control sequences and repair Unicode that cannot be encoded. */
export function sanitizeLog(text: string): string {
  return text
    .replace(OSC, "")
    .replace(ANSI, "")
    .replace(/\r\n?/gu, "\n")
    .replace(CONTROL, "")
    .replace(LONE_SURROGATE, "\uFFFD");
}

export interface LogWindow {
  readonly text: string;
  readonly returnedLines: number;
  readonly matched?: number | undefined;
  /** The selected window does not cover every requested line. */
  readonly truncated: boolean;
}

/**
 * One window over the downloaded log. `search` keeps a few lines of context
 * around each hit and marks the gaps, because a failing command rarely prints
 * its verdict on the line that matched the query.
 */
export function selectLogWindow(
  text: string,
  mode: LogMode,
  maxLines: number,
  query: string | undefined,
): LogWindow {
  const lines = text.split("\n");
  if (mode === "search") {
    const needle = (query ?? "").trim().toLowerCase();
    if (needle === "") {
      throw new IntegrationError(
        "InvalidRequest",
        "search needs a non-empty query",
      );
    }
    return searchWindow(lines, needle, maxLines);
  }
  const kept =
    mode === "head"
      ? lines.slice(0, maxLines)
      : lines.slice(Math.max(0, lines.length - maxLines));
  return {
    text: kept.join("\n"),
    returnedLines: kept.length,
    truncated: kept.length < lines.length,
  };
}

function searchWindow(
  lines: readonly string[],
  needle: string,
  maxLines: number,
): LogWindow {
  const hits: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.toLowerCase().includes(needle)) hits.push(index);
  }
  const selected = new Set<number>();
  let dropped = 0;
  for (const hit of hits) {
    for (
      let index = hit - SEARCH_CONTEXT;
      index <= hit + SEARCH_CONTEXT;
      index += 1
    ) {
      if (index < 0 || index >= lines.length || selected.has(index)) continue;
      if (selected.size >= maxLines) {
        dropped += 1;
        continue;
      }
      selected.add(index);
    }
  }
  const ordered = [...selected].sort((left, right) => left - right);
  const kept: string[] = [];
  let previous: number | undefined;
  for (const index of ordered) {
    // A gap marker keeps the model from reading two distant log regions as
    // consecutive output.
    if (previous !== undefined && index > previous + 1) kept.push("…");
    kept.push(lines[index] ?? "");
    previous = index;
  }
  return {
    text: kept.join("\n"),
    returnedLines: ordered.length,
    matched: hits.length,
    truncated: dropped > 0,
  };
}

/** Cut text to a byte budget without leaving a half-decoded character behind. */
export function trimToBytes(
  text: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return { text, truncated: false };
  const kept = Buffer.from(text, "utf8")
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
  return { text: kept, truncated: true };
}
