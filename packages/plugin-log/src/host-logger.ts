import type { ConsoleLevel, PluginConsoleSink } from "./plugin-logger.js";

/** Minimal DSH/Cordis host logger surface used by plugin console mirrors. */
export interface HostLoggerLike {
  info(message: string, ...values: unknown[]): unknown;
  warn(message: string, ...values: unknown[]): unknown;
  error(message: string, ...values: unknown[]): unknown;
  debug?(message: string, ...values: unknown[]): unknown;
}

/**
 * Adapt a DSH/Cordis context logger to the shared plugin logger's console
 * mirror. Trace falls back to debug, debug falls back to info, and fatal is
 * routed through error because the host exposes four severity methods.
 */
export function createHostLoggerSink(host: HostLoggerLike): PluginConsoleSink {
  return (level: ConsoleLevel, message: string): void => {
    if (level === "trace" || level === "debug") {
      if (typeof host.debug === "function") host.debug(message);
      else host.info(message);
    } else if (level === "info") {
      host.info(message);
    } else if (level === "warn") {
      host.warn(message);
    } else {
      host.error(message);
    }
  };
}
