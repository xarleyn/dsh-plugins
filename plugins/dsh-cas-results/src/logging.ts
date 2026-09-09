/**
 * Structural logging contract consumed inside the plugin.
 *
 * The service binds the shared `@yadsh/dsh-plugin-log` logger to this
 * surface; tests inject a stub. Log records carry hashes, sizes and tool
 * names only — never payload content (SPEC §25).
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
