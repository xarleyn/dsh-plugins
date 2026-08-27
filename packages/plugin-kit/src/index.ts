/**
 * DSH Plugin Kit — shared runtime helpers for DeepSeek Harness plugins.
 *
 * This package provides small, focused utilities that plugins commonly need:
 * - structured logging helpers
 * - configuration validation
 * - compatibility checks
 * - safe feature detection
 */

// Minimal console interface to avoid @types/node dependency
interface ConsoleLike {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

declare const console: ConsoleLike;

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Create a structured logger bound to a plugin name.
 */
export function createLogger(name: string): Logger {
  const prefix = `[dsh:${name}]`;

  return {
    info(message: string, meta?: Record<string, unknown>) {
      console.log(`${prefix} INFO ${message}`, meta ?? {});
    },
    warn(message: string, meta?: Record<string, unknown>) {
      console.warn(`${prefix} WARN ${message}`, meta ?? {});
    },
    error(message: string, meta?: Record<string, unknown>) {
      console.error(`${prefix} ERROR ${message}`, meta ?? {});
    },
  };
}

/**
 * Check if a minimum DSH/Cordis version is available.
 */
export function satisfiesVersion(
  actual: string,
  required: string,
): boolean {
  const partsA = actual.split(".").map((v) => Number.parseInt(v, 10));
  const partsR = required.split(".").map((v) => Number.parseInt(v, 10));

  if (partsA.some(Number.isNaN) || partsR.some(Number.isNaN)) {
    return false;
  }

  const actualMajor = partsA[0] ?? 0;
  const requiredMajor = partsR[0] ?? 0;

  return actualMajor >= requiredMajor;
}

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

  for (const [key, expectedType] of Object.entries(
    schema,
  ) as [string, "string" | "number" | "boolean" | "object"][]) {
    const value = obj[key];

    if (value === undefined) {
      continue; // optional fields
    }

    if (typeof value !== expectedType) {
      throw new Error(
        `Invalid type for "${key}": expected ${expectedType}, got ${typeof value}`,
      );
    }

    result[key] = value;
  }

  return result as T;
}
