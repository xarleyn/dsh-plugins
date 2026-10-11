/**
 * Severity and serialization vocabulary of the plugin logger: the level set,
 * the ordering every sink compares against, and the two guards that turn a
 * config or env string into a level. Nothing here knows about files, consoles
 * or the record bus.
 */

/** Ordered severity levels; `silent` disables the logger entirely. */
export const PLUGIN_LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
] as const;

export type PluginLogLevel = (typeof PLUGIN_LOG_LEVELS)[number];

/** File serialization formats. JSON is NDJSON; text is one readable line. */
export const PLUGIN_LOG_FORMATS = ["json", "text"] as const;

export type PluginLogFormat = (typeof PLUGIN_LOG_FORMATS)[number];

/** Every level except `silent` (which also disables the console mirror). */
export type ConsoleLevel = Exclude<PluginLogLevel, "silent">;

/**
 * Receives console-mirrored records. Must not throw; the wrapper guards every
 * call regardless.
 */
export type PluginConsoleSink = (level: ConsoleLevel, message: string) => void;

/** Default console mirror threshold. */
export const DEFAULT_CONSOLE_LEVEL: PluginLogLevel = "warn";

export const LEVEL_WEIGHT: Record<ConsoleLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Compare a record level against a threshold. `silent` is above every level, so
 * a sink configured to it receives nothing.
 */
export function weightOf(level: PluginLogLevel): number {
  return level === "silent" ? Number.POSITIVE_INFINITY : LEVEL_WEIGHT[level];
}

/** Type guard for level strings (config parsing, env overrides). */
export function isPluginLogLevel(value: unknown): value is PluginLogLevel {
  return (
    typeof value === "string" &&
    (PLUGIN_LOG_LEVELS as readonly string[]).includes(value)
  );
}

/** Type guard for file serialization format strings. */
export function isPluginLogFormat(value: unknown): value is PluginLogFormat {
  return (
    typeof value === "string" &&
    (PLUGIN_LOG_FORMATS as readonly string[]).includes(value)
  );
}
