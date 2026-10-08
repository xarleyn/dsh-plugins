/**
 * Shared file logger for server-side DSH plugins. The wrapper:
 *
 * - wraps `pino` for severity levels and JSON/text serialization;
 * - writes daily files `<dir>/<YYYY-MM-DD>.log`, by default under
 *   `<$DSH_HOME>/logs/<pluginId>`;
 * - mirrors selected records to an injectable console sink (default level
 *   `warn`) so operators still see problems live;
 * - republishes every recorded record on a process-wide bus
 *   ({@link subscribePluginLogRecords}) for live consumers such as the log
 *   panel in `@yadsh/dsh-plugin-log-ui`, which the file destination cannot
 *   serve without parsing it back;
 * - applies `redact` once to the record fields, before the file, console and
 *   bus sinks branch, so a configured secret is cut from every destination;
 * - never throws at runtime: file-system failures degrade to console-only
 *   logging (fail-open), closed loggers silently drop records, and fields that
 *   cannot be read are dropped with the record rather than handed out raw;
 * - disables file output when `DSH_LOG_DISABLED=1`, and under `NODE_ENV=test`
 *   unless `dir` is set explicitly (unit tests never touch a real home).
 *
 * Record shape (one JSON object per line): pino's `level` (numeric),
 * `time` (epoch ms) and `msg` (= the event code), plus `plugin` and the
 * caller's fields; `child(module)` adds `module`. Reserved pino keys
 * (`level`, `time`, `msg`, `plugin`, `module`) must not be used as field
 * names.
 *
 * This module is the orchestrator: the public contract and the two factories
 * that decide whether a logger is new or the cached one. The parts it
 * assembles live beside it — `levels.ts` for the vocabulary, `redact.ts`,
 * `format.ts`, `destination.ts` and `log-files.ts` for what a record becomes
 * and where it lands, `registry.ts` and `record-bus.ts` for the process-wide
 * state, and `logger-core.ts` for the state of one logger.
 */

import { LoggerCore, PluginLoggerImpl } from "./logger-core.js";
import { registryState, type RegistryEntry } from "./registry.js";
import type {
  PluginConsoleSink,
  PluginLogFormat,
  PluginLogLevel,
} from "./levels.js";

export {
  DEFAULT_CONSOLE_LEVEL,
  isPluginLogFormat,
  isPluginLogLevel,
  PLUGIN_LOG_FORMATS,
  PLUGIN_LOG_LEVELS,
} from "./levels.js";
export type {
  ConsoleLevel,
  PluginConsoleSink,
  PluginLogFormat,
  PluginLogLevel,
} from "./levels.js";
export { DEFAULT_LOG_RETENTION_DAYS } from "./log-files.js";
export {
  getRegisteredPluginLoggers,
  setPluginLogFormat,
  setPluginLogLevel,
  subscribePluginLoggerRegistry,
} from "./registry.js";
export type {
  PluginLoggerRegistryListener,
  RegisteredPluginLogger,
} from "./registry.js";
export { subscribePluginLogRecords } from "./record-bus.js";
export type { PluginLogRecord, PluginLogRecordListener } from "./record-bus.js";

/** Logger configuration; every field except `pluginId` is optional. */
export interface PluginLoggerOptions {
  /**
   * Plugin id: directory name, `plugin` record field and env-prefix source
   * (`DSH_LOG_LEVEL_<ID>`). Must match `[A-Za-z0-9][A-Za-z0-9._-]*`.
   */
  readonly pluginId: string;
  /** Severity threshold. Default: `DSH_LOG_LEVEL_<ID>` / `DSH_LOG_LEVEL` env, else `info`. */
  readonly level?: PluginLogLevel;
  /** File serialization format. Default: `json`. */
  readonly format?: PluginLogFormat;
  /** Absolute log directory. Default: `<$DSH_HOME>/logs/<pluginId>`. */
  readonly dir?: string;
  /** Overrides the DSH home used to build the default `dir` (tests). */
  readonly dshHome?: string;
  /** Console mirror threshold; `silent` disables mirroring. Default: `warn`. */
  readonly console?: PluginLogLevel;
  /** Mirror target. Default: the global `console`. */
  readonly consoleSink?: PluginConsoleSink;
  /** Daily files older than this are deleted on rollover. Default: 14; 0 disables. */
  readonly retentionDays?: number;
  /** Master switch for file output. Default: auto (see the module docs). */
  readonly file?: boolean;
  /**
   * Record fields to redact, e.g. `["apiKey"]` — the path syntax pino's `redact`
   * option documents, addressed against the fields object. Applied once per
   * record, before the file, console mirror and record bus split, so every
   * destination cuts the same value. A path that instead addresses the root of
   * pino's own line (`msg`, `plugin`, `module`) is honored by the file only,
   * because those keys exist only there.
   */
  readonly redact?: readonly string[];
  /** Clock for file naming, rollover and retention (tests). */
  readonly now?: () => number;
}

/** Stable logging surface shared by server-side plugins. */
export interface PluginLogger {
  trace(event: string, fields?: Record<string, unknown>): void;
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  fatal(event: string, fields?: Record<string, unknown>): void;
  /** Bound sub-logger that adds a `module` field to every record. */
  child(module: string): PluginLogger;
  /** Current severity threshold. */
  get level(): PluginLogLevel;
  /** Change the severity threshold at runtime. */
  setLevel(level: PluginLogLevel): void;
  /** Current file serialization format. */
  get format(): PluginLogFormat;
  /** Change the file serialization format at runtime. */
  setFormat(format: PluginLogFormat): void;
  /** Best-effort synchronous flush of buffered file output. */
  flush(): void;
  /** Flush and close the destination; idempotent; later writes are dropped. */
  close(): Promise<void>;
}

/** Create a standalone logger instance (no caching). */
export function createPluginLogger(options: PluginLoggerOptions): PluginLogger {
  const core = new LoggerCore(options);
  const root = new PluginLoggerImpl(core);
  core.activate();
  return root;
}

/**
 * Create or return the cached logger for `pluginId` + resolved `dir`. A later
 * call with an explicit `level` updates the cached instance's threshold, so
 * plugin config reloads take effect. `close()` evicts the cache entry; the
 * next call creates a fresh instance.
 */
export function getPluginLogger(options: PluginLoggerOptions): PluginLogger {
  const candidate = new LoggerCore(options);
  const key = candidate.key();
  const state = registryState();
  const existing = state.cache.get(key);
  if (existing === undefined || existing.core.isClosed()) {
    const entry: RegistryEntry = {
      core: candidate,
      root: new PluginLoggerImpl(candidate),
    };
    state.cache.set(key, entry);
    candidate.activate();
    return entry.root;
  }
  if (options.level !== undefined) existing.core.setLevel(options.level);
  if (options.format !== undefined) existing.core.setFormat(options.format);
  return existing.root;
}
