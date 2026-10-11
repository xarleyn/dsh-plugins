import type { Volatile } from "@deepseek-ai/cordis";

export type ManagedPluginLogLevel =
  "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

export type ManagedPluginLogFormat = "json" | "text";

export interface PluginLogUiConfig {
  readonly defaultLevel?: ManagedPluginLogLevel;
  readonly format?: ManagedPluginLogFormat;
  readonly levels?: Readonly<Record<string, ManagedPluginLogLevel>>;
}

/**
 * The same Config after the Host has resolved it: every field of a `0.1.7`
 * Config is a live reference, because volatility is what makes a field editable
 * from the browser and `resolveConfig` must read it at the moment of use.
 */
export interface VolatilePluginLogUiConfig {
  readonly defaultLevel: Volatile<ManagedPluginLogLevel>;
  readonly format: Volatile<ManagedPluginLogFormat>;
  readonly levels: Volatile<Readonly<Record<string, ManagedPluginLogLevel>>>;
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

/**
 * How a temporary level lapses. `timed` closes after a counted window; `session`
 * has no window and closes when the operator revokes it or the Host stops — which
 * is why it is not a setting: a setting outlives both.
 */
export type PluginLogTemporaryScope = "timed" | "session";

/** One temporary level the Host is holding right now. */
export interface PluginLogTemporaryLevel {
  readonly pluginId: string;
  readonly level: ManagedPluginLogLevel;
  readonly scope: PluginLogTemporaryScope;
  /**
   * Milliseconds left when the snapshot was taken. Absent for a session level,
   * which has nothing to count down.
   */
  readonly remainingMs?: number;
}

export interface PluginLogUiSnapshot {
  readonly consumers: readonly PluginLogConsumerSnapshot[];
  readonly temporary: readonly PluginLogTemporaryLevel[];
}

export interface PluginLogUiService {
  inspect(): PluginLogUiSnapshot;
  getConfig(): ResolvedPluginLogUiConfig;
  /**
   * Hold `level` for one plugin without writing it to the Config.
   *
   * The saved overrides are a setting: they stay until someone reverts them, so a
   * stand debugged for one question keeps answering it forever. This is the same
   * `setPluginLogLevel` call a saved override ends in, with no Config behind it —
   * the level lapses on its own and the plugin goes back to what its
   * settings say.
   * @param pluginId - the logger to hold, in the shape an override key takes.
   * @param level - the threshold to hold it at.
   * @param minutes - the window in minutes; omitted means the level holds until it
   * is revoked.
   * @returns the registry snapshot after the level took effect.
   */
  setTemporaryLevel(
    pluginId: string,
    level: ManagedPluginLogLevel,
    minutes?: number,
  ): PluginLogUiSnapshot;
  /**
   * Drop one temporary level early.
   * @param pluginId - the logger whose held level is released.
   * @returns the registry snapshot with the level back on its settings.
   */
  clearTemporaryLevel(pluginId: string): PluginLogUiSnapshot;
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
  "trace" | "debug" | "info" | "warn" | "error" | "fatal";

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
