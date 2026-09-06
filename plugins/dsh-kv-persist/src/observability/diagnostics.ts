/**
 * Structured logging events (SPEC §45).
 *
 * Events use stable dotted names (`kv.session.restore.success`); session
 * identifiers are abbreviated hashes at normal verbosity. The management
 * API key never passes through here. Records land in
 * `<$DSH_HOME>/logs/dsh-kv-persist/<YYYY-MM-DD>.log` (NDJSON); `warn` and
 * above are additionally mirrored to the host context logger.
 */

import { createHostLoggerSink, getPluginLogger, type HostLoggerLike } from "@yadsh/dsh-plugin-log";
import { sha256Hex } from "../snapshots/fingerprint.js";

export interface KvPersistLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** Best-effort synchronous flush of buffered file output. */
  flush?(): void;
  /** Flush and close the underlying destination (idempotent). */
  close?(): Promise<void>;
}

export type KvPersistLogLevel = "debug" | "info" | "off";

/** Abbreviated session hash for logs (SPEC §45: avoid full ids). */
export function abbreviateSessionId(sessionId: string): string {
  return sha256Hex(sessionId).slice(0, 6);
}

/** Fields that must be abbreviated before formatting. */
const SENSITIVE_FIELDS = new Set(["sessionId"]);

function prepareFields(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  if (fields === undefined) return {};
  const prepared: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    prepared[key] =
      SENSITIVE_FIELDS.has(key) && typeof value === "string" ? abbreviateSessionId(value) : value;
  }
  return prepared;
}

/**
 * Build the plugin logger on top of the shared pino-backed file logger
 * (`<$DSH_HOME>/logs/dsh-kv-persist/<YYYY-MM-DD>.log`) with the host context
 * logger as the console mirror for `warn`+ records. Sensitive fields are
 * abbreviated here, before any record leaves the plugin (SPEC §45).
 */
export function createKvPersistLogger(host: HostLoggerLike, level: KvPersistLogLevel): KvPersistLogger {
  const shared = getPluginLogger({
    pluginId: "dsh-kv-persist",
    level: level === "off" ? "silent" : level,
    console: level === "off" ? "silent" : "warn",
    consoleSink: createHostLoggerSink(host),
  });
  return {
    debug(event, fields) {
      shared.debug(event, prepareFields(fields));
    },
    info(event, fields) {
      shared.info(event, prepareFields(fields));
    },
    warn(event, fields) {
      shared.warn(event, prepareFields(fields));
    },
    error(event, fields) {
      shared.error(event, prepareFields(fields));
    },
    flush() {
      shared.flush();
    },
    close() {
      return shared.close();
    },
  };
}
