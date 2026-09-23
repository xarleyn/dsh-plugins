import path from "node:path";
import z from "@deepseek-ai/schemastery";
import { CROSS_DOMAIN_MODES, type CrossDomainMode } from "./types.js";

/** Settings namespace of the plugin's own (non-domain) configuration. */
export const SETTINGS_NAMESPACE = "domain-experts";

/** Settings namespace keys are restricted to this grammar by DSH. */
export const DEFAULT_SUBAGENT_PROVIDER = "spawn";
export const DEFAULT_MEMORY_PROVIDER = "builtin";

/** File the `sqlite` memory provider uses when the deployment names none. */
export const DEFAULT_MEMORY_DB_FILE = "domain-experts-memory.db";

/**
 * Deployment-level plugin configuration (design §23).
 *
 * This is deliberately separate from the user-created domain definitions: a
 * definition is a dynamic record in durable storage, while these are the few
 * scalars an operator sets once. Every field is documented because this schema
 * is the user-facing contract.
 */
export interface Config {
  /** Register the agent-facing tools and serve the management UI. */
  readonly enabled?: boolean;
  /** `ctx.subagents` provider used to spawn expert children. */
  readonly subagentProvider?: string;
  /** Delegation depth cap pre-filled on new domains. */
  readonly defaultMaxDepth?: number;
  /** Parallel experts allowed per calling session when the caller has no domain. */
  readonly defaultMaxParallel?: number;
  /** Cross-domain mode pre-filled on new domains. */
  readonly defaultCrossDomainMode?: string;
  /**
   * Memory provider id every expert uses. Registered when the plugin loads, so
   * naming a provider the deployment did not start with is a restart.
   */
  readonly defaultMemoryProvider?: string;
  /**
   * Database file for the `sqlite` memory provider. Empty selects
   * `<DSH_HOME>/domain-experts-memory.db`, or the working directory when the
   * deployment sets no home.
   */
  readonly memoryDbPath?: string;
  /** Memory records recalled into an expert's persona. */
  readonly recallLimit?: number;
  /** Execution audit entries kept in memory and mirrored to the log. */
  readonly auditLimit?: number;
}

export interface ResolvedConfig {
  readonly enabled: boolean;
  readonly subagentProvider: string;
  readonly defaultMaxDepth: number;
  readonly defaultMaxParallel: number;
  readonly defaultCrossDomainMode: CrossDomainMode;
  readonly defaultMemoryProvider: string;
  /** Absolute path of the `sqlite` provider's database. */
  readonly memoryDbPath: string;
  readonly recallLimit: number;
  readonly auditLimit: number;
}

export const ConfigSchema: z<Config> = z.object({
  enabled: z
    .boolean()
    .default(true)
    .description(
      "Register the agent-facing tools and serve the management UI.",
    ),
  subagentProvider: z
    .string()
    .default(DEFAULT_SUBAGENT_PROVIDER)
    .description("ctx.subagents provider used to spawn expert children."),
  defaultMaxDepth: z
    .natural()
    .default(3)
    .description("Delegation depth cap pre-filled on new domains."),
  defaultMaxParallel: z
    .natural()
    .default(3)
    .description(
      "Parallel experts allowed per calling session when the caller is not itself an expert.",
    ),
  defaultCrossDomainMode: z
    .string()
    .default("expert-only")
    .description(
      "Cross-domain mode pre-filled on new domains: disabled, expert-only or direct-read.",
    ),
  defaultMemoryProvider: z
    .string()
    .default(DEFAULT_MEMORY_PROVIDER)
    .description(
      "Memory provider id every expert uses. Providers are registered when the plugin loads, so naming one the deployment did not start with takes a restart.",
    ),
  memoryDbPath: z
    .string()
    .default("")
    .description(
      `Database file of the sqlite memory provider. Empty selects <DSH_HOME>/${DEFAULT_MEMORY_DB_FILE}.`,
    ),
  recallLimit: z
    .natural()
    .default(5)
    .description("Memory records recalled into an expert's persona."),
  auditLimit: z
    .natural()
    .default(200)
    .description(
      "Execution audit entries kept in memory and mirrored to the log.",
    ),
});

/**
 * Apply defaults and reject a mode the model does not define.
 *
 * An unknown mode is a loud error rather than a silent fallback to
 * `expert-only`: quietly widening cross-domain access would be a policy
 * change the operator did not ask for.
 */
export function resolveConfig(entry: Config = {}): ResolvedConfig {
  const mode = entry.defaultCrossDomainMode ?? "expert-only";
  if (!(CROSS_DOMAIN_MODES as readonly string[]).includes(mode)) {
    throw new Error(
      `domain-experts: defaultCrossDomainMode must be one of ${CROSS_DOMAIN_MODES.join(
        ", ",
      )}; got ${JSON.stringify(mode)}`,
    );
  }
  const recallLimit = coerceNonNegative(entry.recallLimit, 5);
  const auditLimit = coerceNonNegative(entry.auditLimit, 200);
  const defaultMaxDepth = coerceNonNegative(entry.defaultMaxDepth, 3);
  const defaultMaxParallel = coerceNonNegative(entry.defaultMaxParallel, 3);
  const provider = (entry.subagentProvider ?? DEFAULT_SUBAGENT_PROVIDER).trim();
  const memoryProvider = (
    entry.defaultMemoryProvider ?? DEFAULT_MEMORY_PROVIDER
  ).trim();
  const dshHome = process.env.DSH_HOME?.trim();
  const base =
    dshHome === undefined || dshHome === "" ? process.cwd() : dshHome;
  return {
    enabled: entry.enabled ?? true,
    subagentProvider: provider === "" ? DEFAULT_SUBAGENT_PROVIDER : provider,
    defaultMaxDepth,
    defaultMaxParallel,
    defaultCrossDomainMode: mode as CrossDomainMode,
    defaultMemoryProvider:
      memoryProvider === "" ? DEFAULT_MEMORY_PROVIDER : memoryProvider,
    memoryDbPath:
      entry.memoryDbPath?.trim() || path.join(base, DEFAULT_MEMORY_DB_FILE),
    recallLimit,
    auditLimit: Math.max(1, auditLimit),
  };
}

function coerceNonNegative(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value) || value < 0)
    return fallback;
  return Math.trunc(value);
}

/** Defaults a new domain inherits from the plugin configuration. */
export function domainDraftDefaults(config: ResolvedConfig): {
  readonly maxDepth: number;
  readonly crossDomainMode: CrossDomainMode;
} {
  return {
    maxDepth: config.defaultMaxDepth,
    crossDomainMode: config.defaultCrossDomainMode,
  };
}
