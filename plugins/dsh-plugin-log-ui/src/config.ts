import z from "@deepseek-ai/schemastery";
import type {
  ManagedPluginLogFormat,
  ManagedPluginLogLevel,
  PluginLogUiConfig,
  ResolvedPluginLogUiConfig,
  VolatilePluginLogUiConfig,
} from "./types.js";

export const MANAGED_LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
] as const satisfies readonly ManagedPluginLogLevel[];

export const MANAGED_LOG_FORMATS = [
  "json",
  "text",
] as const satisfies readonly ManagedPluginLogFormat[];

export const DEFAULT_PLUGIN_LOG_UI_CONFIG: ResolvedPluginLogUiConfig =
  Object.freeze({
    defaultLevel: "info",
    format: "text",
    levels: Object.freeze({}),
  });

const levelSchema = z.union(MANAGED_LOG_LEVELS);

/*
 * `0.1.7` has no settings namespace a plugin registers by name: a field is
 * browser-editable exactly when its schema node carries `.volatile()`, and the
 * Host publishes the whole Config under the profile entry id. Each field is
 * marked on its own — volatility may not sit inside a dictionary's values, so
 * `levels` carries the mark as one container.
 */
export const ConfigSchema: z<PluginLogUiConfig, VolatilePluginLogUiConfig> =
  z.object({
    defaultLevel: levelSchema
      .default(DEFAULT_PLUGIN_LOG_UI_CONFIG.defaultLevel)
      .volatile(),
    format: z
      .union(MANAGED_LOG_FORMATS)
      .default(DEFAULT_PLUGIN_LOG_UI_CONFIG.format)
      .volatile(),
    levels: z.dict(levelSchema).default({}).volatile(),
  });

/**
 * The shape of a logger id the Config accepts as an override key. A temporary
 * level is addressed by the same identifier, so both paths validate it the same
 * way and an operator cannot reach a logger through the door settings closed.
 */
export const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function resolveConfig(
  input: PluginLogUiConfig = {},
): ResolvedPluginLogUiConfig {
  const levels: Record<string, ManagedPluginLogLevel> = {};
  for (const [pluginId, level] of Object.entries(input.levels ?? {})) {
    if (!PLUGIN_ID_PATTERN.test(pluginId)) {
      throw new TypeError(
        `plugin log override id is invalid: ${JSON.stringify(pluginId)}`,
      );
    }
    if (!MANAGED_LOG_LEVELS.includes(level)) {
      throw new TypeError(
        `plugin log override level is invalid: ${JSON.stringify(level)}`,
      );
    }
    levels[pluginId] = level;
  }
  const defaultLevel =
    input.defaultLevel ?? DEFAULT_PLUGIN_LOG_UI_CONFIG.defaultLevel;
  const format = input.format ?? DEFAULT_PLUGIN_LOG_UI_CONFIG.format;
  if (!MANAGED_LOG_LEVELS.includes(defaultLevel)) {
    throw new TypeError(
      `default plugin log level is invalid: ${JSON.stringify(defaultLevel)}`,
    );
  }
  if (!MANAGED_LOG_FORMATS.includes(format)) {
    throw new TypeError(
      `plugin log format is invalid: ${JSON.stringify(format)}`,
    );
  }
  return Object.freeze({
    defaultLevel,
    format,
    levels: Object.freeze(levels),
  });
}
