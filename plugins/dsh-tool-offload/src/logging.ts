/**
 * Structural logging contract consumed inside the plugin.
 *
 * The service binds the shared `@yadsh/dsh-plugin-log` logger to this
 * surface; tests inject a stub. Log records carry tool names, sizes,
 * reasons and durations only — never tool result content (SPEC §26
 * "no raw output in logs").
 */

export interface PluginLoggerLike {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function silentPluginLogger(): PluginLoggerLike {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}
