export type ManagedPluginLogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";

export type ManagedPluginLogFormat = "json" | "text";

export interface PluginLogUiConfig {
  readonly defaultLevel?: ManagedPluginLogLevel;
  readonly format?: ManagedPluginLogFormat;
  readonly levels?: Readonly<Record<string, ManagedPluginLogLevel>>;
}

export interface ResolvedPluginLogUiConfig {
  readonly defaultLevel: ManagedPluginLogLevel;
  readonly format: ManagedPluginLogFormat;
  readonly levels: Readonly<Record<string, ManagedPluginLogLevel>>;
}

export interface PluginLogConsumerSnapshot {
  readonly pluginId: string;
  readonly level: ManagedPluginLogLevel;
  readonly format: ManagedPluginLogFormat;
  readonly instances: number;
}

export interface PluginLogUiSnapshot {
  readonly consumers: readonly PluginLogConsumerSnapshot[];
}

export interface PluginLogUiService {
  inspect(): PluginLogUiSnapshot;
  getConfig(): ResolvedPluginLogUiConfig;
  /**
   * Read the records the ring buffer holds after `cursor`.
   *
   * A polling reader keeps the cursor of the previous read and receives only
   * what arrived since; the answer reports how much the buffer evicted before
   * it could be delivered, so a panel can say so instead of silently skipping
   * lines.
   * @param cursor - the sequence to resume from; `0` reads whatever the buffer holds.
   * @param limit - the maximum number of records to return in this read.
   * @returns the records, the next cursor, and the buffer's state.
   */
  tail(cursor: number, limit: number): PluginLogTail;
}

/** Severity a record carries. `silent` never appears: that level emits nothing. */
export type PluginLogRecordLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal";

/**
 * One event field, rendered for display by the host.
 *
 * The host renders rather than shipping raw values because a record's fields
 * are arbitrary plugin data — cyclic objects, errors, functions — while the
 * Remote boundary carries plain JSON.
 */
export interface PluginLogField {
  readonly key: string;
  readonly value: string;
}

/** One log record as the panel receives it. */
export interface PluginLogRecordView {
  /** Process-wide sequence the reader resumes from. */
  readonly seq: number;
  /** Emission time in epoch ms. */
  readonly time: number;
  readonly level: PluginLogRecordLevel;
  readonly pluginId: string;
  /** `child(module)` scope; empty string for the root logger. */
  readonly module: string;
  /** The stable event code. */
  readonly event: string;
  readonly fields: readonly PluginLogField[];
}

/** One tail read. */
export interface PluginLogTail {
  readonly records: readonly PluginLogRecordView[];
  /** Cursor to send with the next read. */
  readonly cursor: number;
  /** Records the buffer evicted before this read could deliver them. */
  readonly dropped: number;
  /** Records the buffer currently holds. */
  readonly buffered: number;
  /** Records the buffer can hold, so a reader can size its own window. */
  readonly capacity: number;
}
