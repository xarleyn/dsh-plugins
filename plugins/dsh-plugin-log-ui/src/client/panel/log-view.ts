/**
 * The panel's view state, as pure functions: what the filters keep, how a new
 * batch joins the window, and how one record reads as a line.
 *
 * The component owns only React state; every decision about which records are
 * visible and what a line says lives here, so a reader of the panel can test
 * the filtering without a DOM and the component stays a rendering of this.
 */
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type {
  PluginLogRecordLevel,
  PluginLogRecordView,
  PluginLogTail,
} from "../../types.js";

/** Records the panel keeps. The host buffer is larger; this is what a reader scrolls. */
export const LOG_PANEL_CAPACITY = 500;

/** Records one poll asks for. A reader that falls behind drains over several polls. */
export const LOG_PANEL_READ_LIMIT = 500;

/** How often an open panel asks for new records. */
export const LOG_PANEL_POLL_MS = 1_000;

/** Levels in severity order, as the filter row offers them. */
export const LOG_PANEL_LEVELS: readonly PluginLogRecordLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

/** Two-digit zero padding, for the clock. */
function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * The clock a line leads with: local `HH:MM:SS.mmm`, which is what a reader
 * compares against when matching a log line to what they just did.
 * @param time - emission time in epoch ms.
 * @returns the formatted clock.
 */
export function formatTime(time: number): string {
  const date = new Date(time);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** The plugin scope a line shows: `plugin` or `plugin/module`. */
export function formatScope(record: PluginLogRecordView): string {
  return record.module === "" ? record.pluginId : `${record.pluginId}/${record.module}`;
}

/**
 * The line's text, as one string: clock, level, scope, event, fields.
 * Used for rendering, and for the text filter's haystack.
 * @param record - the record to render.
 * @returns one line of log text.
 */
export function formatRecord(record: PluginLogRecordView): string {
  const fields = record.fields.map((field) => `${field.key}=${field.value}`).join(" ");
  const head = `${formatTime(record.time)} ${record.level.toUpperCase().padEnd(5)} [${formatScope(record)}] ${record.event}`;
  return fields === "" ? head : `${head} ${fields}`;
}

/**
 * Whether one record passes the filters.
 *
 * The text filter is a case-insensitive substring of the whole line, so what a
 * reader types matches what they see; an empty query keeps everything.
 * @param record - the record to test.
 * @param levels - levels the reader kept enabled.
 * @param query - the text filter, already trimmed.
 * @returns whether the record is visible.
 */
export function matchesFilter(
  record: PluginLogRecordView,
  levels: ReadonlySet<PluginLogRecordLevel>,
  query: string,
): boolean {
  if (!levels.has(record.level)) return false;
  if (query === "") return true;
  return formatRecord(record).toLowerCase().includes(query.toLowerCase());
}

/**
 * Apply the filters to a window of records.
 * @param records - the window, oldest first.
 * @param levels - levels the reader kept enabled.
 * @param query - the raw text filter.
 * @returns the visible records, oldest first.
 */
export function filterRecords(
  records: readonly PluginLogRecordView[],
  levels: ReadonlySet<PluginLogRecordLevel>,
  query: string,
): readonly PluginLogRecordView[] {
  const trimmed = query.trim();
  if (trimmed === "" && levels.size === LOG_PANEL_LEVELS.length) return records;
  return records.filter((record) => matchesFilter(record, levels, trimmed));
}

/**
 * Join a poll's batch onto the window, dropping the oldest past the capacity.
 *
 * Records the window already holds are skipped: a poll can only return records
 * after the cursor it was given, but a re-read after a failed poll must not
 * duplicate what did arrive.
 * @param current - the window, oldest first.
 * @param batch - the records a poll returned, oldest first.
 * @param capacity - how many records to keep.
 * @returns the new window.
 */
export function appendRecords(
  current: readonly PluginLogRecordView[],
  batch: readonly PluginLogRecordView[],
  capacity: number = LOG_PANEL_CAPACITY,
): readonly PluginLogRecordView[] {
  if (batch.length === 0) return current;
  const last = current[current.length - 1]?.seq ?? -1;
  const fresh = batch.filter((record) => record.seq > last);
  if (fresh.length === 0) return current;
  const merged = [...current, ...fresh];
  return merged.length <= capacity ? merged : merged.slice(merged.length - capacity);
}

/** What one poll produced, as the panel's reader reports it. */
export type LogTailRead =
  | { readonly ok: true; readonly value: PluginLogTail }
  | { readonly ok: false; readonly message: string };

/** The Remote call one reader binds to. */
export interface LogTailRemote {
  tail(cursor: number, limit: number): Promise<RemoteResult<PluginLogTail>>;
}

/** The panel's read face: one call per poll, with failures already turned into text. */
export type ReadLogTail = (cursor: number, limit: number) => Promise<LogTailRead>;

/** The message a failed Remote result carries. */
function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Could not read the plugin log stream.";
}

/**
 * Bind the panel's read face to one Remote namespace, translating the transport
 * envelope into the panel's own outcome so the component never inspects it.
 * @param remote - the mounted `pluginLogUi` namespace.
 * @returns the read face the panel polls with.
 */
export function createLogTailReader(remote: LogTailRemote): ReadLogTail {
  return async (cursor, limit) => {
    try {
      const result = await remote.tail(cursor, limit);
      return result.ok ? { ok: true, value: result.value } : { ok: false, message: failureMessage(result.error) };
    } catch (error) {
      return { ok: false, message: failureMessage(error) };
    }
  };
}
