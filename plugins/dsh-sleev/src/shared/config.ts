import type { Volatile } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

/** Loader configuration for the host-side Sleev observer. */
export interface Config {
  /** Exact DSH provider route names known to pass through Sleev. */
  routes: Volatile<string[]>;
  /** Provider-name prefixes known to pass through Sleev (default `sleev-`). */
  routePrefixes: Volatile<string[]>;
  /** Maximum number of completed calls retained in process memory (default 100). */
  maxRecentCalls: Volatile<number>;
  /** Telemetry logging verbosity (default `info`). */
  logLevel: Volatile<"off" | "info" | "debug">;
}

/** One plain read of the live fields; every editable field is volatile. */
export interface ConfigSnapshot {
  readonly routes?: readonly string[];
  readonly routePrefixes?: readonly string[];
  readonly maxRecentCalls?: number;
  readonly logLevel?: "off" | "info" | "debug";
}

/** Fully materialized and validated observer configuration. */
export interface ResolvedConfig {
  readonly routes: readonly string[];
  readonly routePrefixes: readonly string[];
  readonly maxRecentCalls: number;
  readonly logLevel: "off" | "info" | "debug";
}

/** Cordis loader schema. Semantic validation remains in {@link resolveConfig}. */
export const ConfigSchema = z.object({
  routes: z.array(z.string()).default([]).volatile(),
  routePrefixes: z.array(z.string()).default(["sleev-"]).volatile(),
  maxRecentCalls: z.number().step(1).min(1).default(100).volatile(),
  logLevel: z
    .union(["off", "info", "debug"] as const)
    .default("info")
    .volatile(),
});

/**
 * Take one snapshot of a live Config.
 *
 * The volatile references are stable, so a caller that destructured once at
 * service construction would freeze the values; every operation reads through
 * this function instead.
 */
export function snapshotConfig(config: Config): ConfigSnapshot {
  return {
    routes: config.routes.get(),
    routePrefixes: config.routePrefixes.get(),
    maxRecentCalls: config.maxRecentCalls.get(),
    logLevel: config.logLevel.get(),
  };
}

function uniqueNonEmpty(values: readonly string[], field: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new Error(`dsh-sleev: ${field} cannot contain an empty value`);
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** Apply runtime defaults and reject ambiguous route matchers. */
export function resolveConfig(config: ConfigSnapshot = {}): ResolvedConfig {
  const maxRecentCalls = config.maxRecentCalls ?? 100;
  if (!Number.isSafeInteger(maxRecentCalls) || maxRecentCalls < 1) {
    throw new Error(
      "dsh-sleev: maxRecentCalls must be a positive safe integer",
    );
  }
  return Object.freeze({
    routes: Object.freeze(uniqueNonEmpty(config.routes ?? [], "routes")),
    routePrefixes: Object.freeze(
      uniqueNonEmpty(config.routePrefixes ?? ["sleev-"], "routePrefixes"),
    ),
    maxRecentCalls,
    logLevel: config.logLevel ?? "info",
  });
}

/** Whether a DSH route is explicitly declared as externally optimized. */
export function matchesOptimizedRoute(
  provider: string,
  config: Pick<ResolvedConfig, "routes" | "routePrefixes">,
): boolean {
  return (
    config.routes.includes(provider) ||
    config.routePrefixes.some((prefix) => provider.startsWith(prefix))
  );
}
