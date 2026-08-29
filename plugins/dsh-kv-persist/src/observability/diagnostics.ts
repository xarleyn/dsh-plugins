/**
 * Structured logging events (SPEC §45).
 *
 * Events use stable dotted names (`kv.session.restore.success`); session
 * identifiers are abbreviated hashes at normal verbosity. The management
 * API key never passes through here.
 */

import { sha256Hex } from "../snapshots/fingerprint.js";

export interface KvPersistLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
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

interface HostLoggerLike {
  info(message: string, ...values: unknown[]): unknown;
  warn(message: string, ...values: unknown[]): unknown;
  error(message: string, ...values: unknown[]): unknown;
  debug?(message: string, ...values: unknown[]): unknown;
}

/** Build the plugin logger on top of the host context logger. */
export function createKvPersistLogger(host: HostLoggerLike, level: KvPersistLogLevel): KvPersistLogger {
  const format = (event: string, fields?: Record<string, unknown>): string => {
    const prepared = prepareFields(fields);
    const parts = Object.entries(prepared).map(([key, value]) => `${key}=${String(value)}`);
    return parts.length > 0 ? `[kv-persist] ${event} ${parts.join(" ")}` : `[kv-persist] ${event}`;
  };
  return {
    debug(event, fields) {
      if (level === "debug") {
        const message = format(event, fields);
        if (typeof host.debug === "function") host.debug(message);
        else host.info(message);
      }
    },
    info(event, fields) {
      if (level === "debug" || level === "info") host.info(format(event, fields));
    },
    warn(event, fields) {
      if (level !== "off") host.warn(format(event, fields));
    },
    error(event, fields) {
      if (level !== "off") host.error(format(event, fields));
    },
  };
}
