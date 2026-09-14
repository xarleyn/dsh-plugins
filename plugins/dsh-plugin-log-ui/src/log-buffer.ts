/**
 * The bounded stream the log panel reads: recent records, keyed by sequence.
 *
 * The bus in `@yadsh/dsh-plugin-log` holds no history, so a panel that opens
 * after a plugin started would have nothing to draw. This buffer keeps the last
 * {@link LOG_BUFFER_CAPACITY} records and answers a reader from a cursor, which
 * is what makes the live view a poll of a sequence rather than a stream of
 * events the transport would have to hold open.
 *
 * Two properties the panel depends on:
 *
 * - **No silent gaps.** When the buffer evicts records the reader has not seen
 *   yet, the next read reports how many, so the panel says "N records dropped"
 *   instead of drawing two lines that never happened next to each other.
 * - **Rendering stays here.** Fields arrive as arbitrary plugin data and leave
 *   as display strings, because the Remote boundary carries plain JSON and a
 *   record may hold a cyclic object, an `Error`, or a function.
 */
import type { PluginLogRecord } from "@yadsh/dsh-plugin-log";
import type {
  PluginLogField,
  PluginLogRecordView,
  PluginLogTail,
} from "./types.js";

/** Records kept for a reader that attaches late. Roughly a few screens of panel. */
export const LOG_BUFFER_CAPACITY = 2_000;

/** Records one read may return. A reader that falls behind drains in several reads. */
export const LOG_TAIL_MAX_LIMIT = 500;

/** Fields kept per record; the rest are summarized in one trailing entry. */
export const LOG_FIELD_LIMIT = 24;

/** Longest rendered field value; longer text is cut with an ellipsis. */
export const LOG_FIELD_VALUE_LIMIT = 400;

/** Deepest value rendered before its contents are elided. */
const LOG_FIELD_DEPTH_LIMIT = 3;

/** Cut a rendered value to the display limit. */
function truncate(text: string): string {
  return text.length <= LOG_FIELD_VALUE_LIMIT
    ? text
    : `${text.slice(0, LOG_FIELD_VALUE_LIMIT - 1)}…`;
}

/** Render one field value as display text, bounded in depth and length. */
function renderValue(value: unknown, depth: number): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return truncate(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value instanceof Error)
    return truncate(`${value.name}: ${value.message}`);
  if (depth >= LOG_FIELD_DEPTH_LIMIT)
    return Array.isArray(value) ? "[…]" : "{…}";
  if (Array.isArray(value)) {
    return truncate(
      `[${value.map((item) => renderValue(item, depth + 1)).join(", ")}]`,
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const rendered = entries.map(
      ([key, item]) => `${key}: ${renderValue(item, depth + 1)}`,
    );
    return truncate(`{${rendered.join(", ")}}`);
  }
  // Functions and symbols: say what it was, nothing more.
  return truncate(String(value));
}

/**
 * Render one record's fields for display.
 * @param fields - the caller's fields, as the logger received them.
 * @returns short key/value pairs, capped in count.
 */
export function renderFields(
  fields: Readonly<Record<string, unknown>>,
): readonly PluginLogField[] {
  const entries = Object.entries(fields);
  const rendered: PluginLogField[] = entries
    .slice(0, LOG_FIELD_LIMIT)
    .map(([key, value]) =>
      Object.freeze({ key, value: renderValue(value, 0) }),
    );
  if (entries.length > LOG_FIELD_LIMIT) {
    rendered.push(
      Object.freeze({
        key: "…",
        value: `${entries.length - LOG_FIELD_LIMIT} more field(s)`,
      }),
    );
  }
  return Object.freeze(rendered);
}

/** Convert one bus record into the shape the panel reads. */
export function toRecordView(record: PluginLogRecord): PluginLogRecordView {
  return Object.freeze({
    seq: record.seq,
    time: record.time,
    level: record.level,
    pluginId: record.pluginId,
    module: record.module ?? "",
    event: record.event,
    fields: renderFields(record.fields),
  });
}

/** Clamp a requested read size into the range the buffer serves. */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return LOG_TAIL_MAX_LIMIT;
  return Math.min(Math.floor(limit), LOG_TAIL_MAX_LIMIT);
}

/** Clamp a requested cursor into a non-negative integer sequence. */
export function clampCursor(cursor: number): number {
  if (!Number.isFinite(cursor) || cursor < 0) return 0;
  return Math.floor(cursor);
}

/** The ring buffer one plugin instance keeps for its readers. */
export class PluginLogBuffer {
  private readonly records: PluginLogRecordView[] = [];
  /** Highest sequence appended so far; the cursor a fresh reader starts from. */
  private lastSeq = 0;
  /**
   * Lowest sequence ever appended, or `undefined` before the first one.
   *
   * Sequences are process-wide and contiguous but start wherever the host's
   * bus was when this plugin subscribed, so a reader asking from `0` must not be
   * told about the sequences that existed before this buffer did.
   */
  private firstSeq: number | undefined;

  /** @param capacity - records to retain; older ones are evicted first. */
  constructor(private readonly capacity: number = LOG_BUFFER_CAPACITY) {}

  /** Append one bus record, evicting the oldest when the buffer is full. */
  append(record: PluginLogRecord): void {
    this.firstSeq ??= record.seq;
    this.records.push(toRecordView(record));
    this.lastSeq = record.seq;
    while (this.records.length > this.capacity) this.records.shift();
  }

  /** The cursor a reader should start from to see only what comes next. */
  head(): number {
    return this.lastSeq + 1;
  }

  /**
   * Read everything the buffer holds from `cursor` on.
   * @param cursor - sequence to resume from.
   * @param limit - maximum records to return.
   * @returns the batch, the next cursor, and what the buffer evicted unseen.
   */
  read(cursor: number, limit: number): PluginLogTail {
    const from = clampCursor(cursor);
    const size = clampLimit(limit);
    const first = this.firstSeq;
    const oldest = this.records[0]?.seq ?? this.lastSeq + 1;
    const start = Math.max(from, oldest);
    const records = this.records
      .filter((record) => record.seq >= start)
      .slice(0, size);
    // Before the first record this buffer ever held there is nothing to have
    // lost; from anywhere at or past it, every sequence below `oldest` was
    // evicted before the reader could see it.
    const dropped =
      first === undefined ? 0 : Math.max(0, oldest - Math.max(from, first));
    const next =
      records.length > 0
        ? records[records.length - 1]!.seq + 1
        : first === undefined
          ? from
          : start;
    return Object.freeze({
      records: Object.freeze(records),
      cursor: next,
      dropped,
      buffered: this.records.length,
      capacity: this.capacity,
    });
  }
}
