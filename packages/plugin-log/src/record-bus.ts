/**
 * The record bus: every record a plugin logger emits, republished in-process
 * for live consumers.
 *
 * The state it uses lives in the same {@link GlobalRegistryState} as the logger
 * registry, so duplicate loads of this package share one bus, and it is
 * completed lazily because a copy of the package that predates the bus created
 * that state without these fields.
 */

import { registryState, type GlobalRegistryState } from "./registry.js";
import type { ConsoleLevel } from "./levels.js";

/**
 * One record a plugin logger emitted, as the record bus delivers it.
 *
 * A consumer that wants to draw or forward live output subscribes with
 * {@link subscribePluginLogRecords} and keeps its own buffer: the bus holds no
 * history, so a subscriber sees exactly what is emitted while it is attached.
 * Fields carry the logger's own `redact` applied, so a secret a plugin
 * configured away never reaches a consumer; what is left of them is the
 * caller's data as recorded, because rendering stays the consumer's decision —
 * a transport that serializes the fields owns the display sanitization.
 */
export interface PluginLogRecord {
  /** Process-wide monotonic sequence; a consumer resumes from it instead of from time. */
  readonly seq: number;
  /** Emission time in epoch ms, from the logger's own clock. */
  readonly time: number;
  /** Severity the logger recorded at. Never `silent`: that level emits nothing. */
  readonly level: ConsoleLevel;
  /** Owner of the emitting logger. */
  readonly pluginId: string;
  /** `child(module)` scope, or `undefined` for the root logger. */
  readonly module: string | undefined;
  /** The stable event code (pino's `msg`). */
  readonly event: string;
  /**
   * The caller's fields after the logger's `redact` paths, as a frozen top-level
   * copy: the caller keeps writing to the object it passed, but nested values
   * are still the very objects the caller owns, so this is not a deep snapshot.
   */
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Receives every record a plugin logger emits. Must not throw; the bus guards the call. */
export type PluginLogRecordListener = (record: PluginLogRecord) => void;

/** The record bus as it lives in the shared registry state, optional because an older copy of this package may have created that state. */
interface RecordBusState {
  recordListeners?: Set<PluginLogRecordListener>;
  nextRecordSeq?: number;
}

/**
 * The record bus, lazily completed on the shared registry symbol.
 *
 * What reaches the bus is decided by the level threshold and by the record's own
 * fields: a record below its logger's level is not emitted at all, exactly as it
 * is not written to the file, and neither is one whose fields cannot be read
 * through the logger's `redact` paths. Emission is fail-open — a throwing
 * listener cannot affect the logger.
 */
function recordBus(): Required<RecordBusState> {
  const state = registryState() as GlobalRegistryState & RecordBusState;
  state.recordListeners ??= new Set<PluginLogRecordListener>();
  state.nextRecordSeq ??= 1;
  return state as Required<RecordBusState>;
}

/**
 * Subscribe to every record the plugin loggers emit from now on.
 *
 * The listener runs synchronously inside the emitting `write`, so it must stay
 * cheap and must not log through a plugin logger (that would recurse).
 * @param listener - synchronous record callback.
 * @returns idempotent unsubscribe.
 */
export function subscribePluginLogRecords(
  listener: PluginLogRecordListener,
): () => void {
  const bus = recordBus();
  bus.recordListeners.add(listener);
  return () => {
    bus.recordListeners.delete(listener);
  };
}

/**
 * Publish one record to the attached consumers.
 * @param fields - the copy `write` took for this record: the bus freezes what it
 * is handed, so it must never be the object the caller still owns.
 */
export function publishPluginLogRecord(
  pluginId: string,
  module: string | undefined,
  level: ConsoleLevel,
  time: number,
  event: string,
  fields: Record<string, unknown>,
): void {
  const bus = recordBus();
  const record: PluginLogRecord = Object.freeze({
    seq: bus.nextRecordSeq,
    time,
    level,
    pluginId,
    module,
    event,
    // Shallow: the nested values stay the ones the caller logged, so the record
    // is a copy of what was handed in, not a snapshot of what is in it.
    fields: Object.freeze(fields),
  });
  bus.nextRecordSeq += 1;
  for (const listener of bus.recordListeners) {
    try {
      listener(record);
    } catch {
      // Consumers must never affect logging or plugin execution.
    }
  }
}
