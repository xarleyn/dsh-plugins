/**
 * DSH Plugin Kit — shared runtime helpers for DeepSeek Harness plugins.
 *
 * This private package provides small, focused development utilities:
 * - configuration validation
 * - `./client` scaffolding for browser bundles
 *
 * SQLite plumbing for stores that outgrow a JSON document lives behind the
 * `./sqlite` subpath rather than here: it needs Node's `node:sqlite`, and this
 * entry point is imported by test helpers that run in browser-like
 * environments, where an eager Node import is a runtime error.
 */

/**
 * Validate a configuration object against a simple schema.
 */
export function validateConfig<T extends Record<string, unknown>>(
  config: unknown,
  schema: Record<keyof T, "string" | "number" | "boolean" | "object">,
): T {
  if (config === null || typeof config !== "object") {
    throw new Error("Configuration must be an object");
  }

  const obj = config as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, expectedType] of Object.entries(schema) as [
    string,
    "string" | "number" | "boolean" | "object",
  ][]) {
    const value = obj[key];

    if (value === undefined) {
      continue; // optional fields
    }

    if (
      typeof value !== expectedType ||
      (expectedType === "object" && value === null)
    ) {
      const actualType = value === null ? "null" : typeof value;
      throw new Error(
        `Invalid type for "${key}": expected ${expectedType}, got ${actualType}`,
      );
    }

    result[key] = value;
  }

  return result as T;
}
