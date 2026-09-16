/**
 * Structural logging contract consumed inside server-side plugins.
 *
 * Services and tool factories accept this narrow surface instead of the full
 * {@link PluginLogger}; a real logger satisfies it structurally, so the
 * plugin entrypoint binds `getPluginLogger(...)` (usually through
 * `createHostLoggerSink`-backed loggers) and tests inject a stub such as
 * {@link silentPluginLogger}. Whatever a plugin records through it must carry
 * metadata only — event codes, hashes, sizes, durations — never payload
 * content.
 */

export interface PluginLoggerLike {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/** A logger that records nothing; the default for optional diagnostics. */
export function silentPluginLogger(): PluginLoggerLike {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}
