/**
 * Structural logging contract consumed inside the plugin.
 *
 * The entrypoint binds the shared `@yadsh/dsh-plugin-log` logger to this
 * surface; tool factories and tests inject a stub. Log records carry tool
 * names, exit codes, durations and truncation flags only — never git output
 * content, commit messages or repository paths beyond the resolved root.
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
