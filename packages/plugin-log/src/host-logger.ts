import type { ConsoleLevel, PluginConsoleSink } from "./plugin-logger.js";

/** Minimal DSH/Cordis host logger surface used by plugin console mirrors. */
export interface HostLoggerLike {
  info(message: string, ...values: unknown[]): unknown;
  warn(message: string, ...values: unknown[]): unknown;
  error(message: string, ...values: unknown[]): unknown;
  debug?(message: string, ...values: unknown[]): unknown;
}

export interface HostLoggerSinkOptions {
  /**
   * Mirror `trace`/`debug` records through `host.info` even when the host
   * exposes `debug`. Use this only when the mirror previously behaved that
   * way and callers depend on verbose records staying visible.
   */
  readonly verboseToInfo?: boolean;
}

/**
 * Adapt a DSH/Cordis context logger to the shared plugin logger's console
 * mirror. Trace falls back to debug, debug falls back to info, and fatal is
 * routed through error because the host exposes four severity methods.
 */
export function createHostLoggerSink(
  host: HostLoggerLike,
  options: HostLoggerSinkOptions = {},
): PluginConsoleSink {
  return (level: ConsoleLevel, message: string): void => {
    if (level === "trace" || level === "debug") {
      if (options.verboseToInfo !== true && typeof host.debug === "function") host.debug(message);
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
