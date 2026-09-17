/**
 * Plugin configuration: the Schemastery schema (the user-facing contract) and
 * the resolution of the audit root.
 *
 * Every field here is documented because it is what a reader of the profile's
 * patch layer sees; none of them is read from the environment except the two
 * the SPEC §56 fixes: `DSH_AUDIT_ROOT` and the harness-wide `DSH_HOME`.
 */
import z from "@deepseek-ai/schemastery";
import { expandHomePath, resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { resolve } from "node:path";

/** The audit root's directory name under `$DSH_HOME`. */
export const AUDIT_ROOT_DIRECTORY = "audits";

/** Environment variable that overrides the audit root outright. */
export const AUDIT_ROOT_ENV = "DSH_AUDIT_ROOT";

/** How the file watcher is driven. */
export type AuditWatchMode = "auto" | "events" | "poll";

export interface SessionAuditConfig {
  /** Whether the plugin scans, watches and serves audits at all. */
  readonly enabled?: boolean;
  /**
   * Audit root. Blank resolves from `$DSH_AUDIT_ROOT`, then `$DSH_HOME/audits`.
   */
  readonly auditRoot?: string;
  /** Watch the audit root for changes. Off leaves periodic reconciliation only. */
  readonly watch?: boolean;
  /**
   * `auto` lets the native backend decide, `events` forces native events, and
   * `poll` forces interval polling — the mode for a bind mount, a network
   * share, or a Syncthing folder where native events never arrive.
   */
  readonly watchMode?: AuditWatchMode;
  /**
   * Quiet period after a filesystem event before the root is re-read. This is
   * what makes a directory copied in file by file safe: the copy settles first.
   */
  readonly settleMs?: number;
  /** Reconciliation interval. `0` disables the timer. */
  readonly rescanIntervalMs?: number;
  /**
   * Resolve a session by the directory name's prefix when the analysis itself
   * declares no session id. Only ever used as the fallback.
   */
  readonly allowDirectoryPrefixMatch?: boolean;
  /** Refuse an `analysis.json` larger than this. */
  readonly maxAnalysisBytes?: number;
  /** Refuse a `REPORT.md` larger than this. */
  readonly maxReportBytes?: number;
  /** Reserved for the session-header badge; the Audit tab does not depend on it. */
  readonly exposeHeaderBadge?: boolean;
}

/** Configuration with every default applied. */
export interface ResolvedSessionAuditConfig {
  readonly enabled: boolean;
  readonly auditRoot: string;
  readonly watch: boolean;
  readonly watchMode: AuditWatchMode;
  readonly settleMs: number;
  readonly rescanIntervalMs: number;
  readonly allowDirectoryPrefixMatch: boolean;
  readonly maxAnalysisBytes: number;
  readonly maxReportBytes: number;
  readonly exposeHeaderBadge: boolean;
}

export const DEFAULT_SETTLE_MS = 1_000;
export const DEFAULT_RESCAN_INTERVAL_MS = 30_000;
export const DEFAULT_MAX_ANALYSIS_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_REPORT_BYTES = 5 * 1024 * 1024;

/** The Schemastery schema DSH validates a profile's config against. */
export const Config: z<SessionAuditConfig> = z.object({
  enabled: z.boolean().default(true),
  auditRoot: z.string().default(""),
  watch: z.boolean().default(true),
  watchMode: z
    .union([z.const("auto"), z.const("events"), z.const("poll")])
    .default("auto"),
  settleMs: z.natural().default(DEFAULT_SETTLE_MS),
  rescanIntervalMs: z.natural().default(DEFAULT_RESCAN_INTERVAL_MS),
  allowDirectoryPrefixMatch: z.boolean().default(true),
  maxAnalysisBytes: z.natural().default(DEFAULT_MAX_ANALYSIS_BYTES),
  maxReportBytes: z.natural().default(DEFAULT_MAX_REPORT_BYTES),
  exposeHeaderBadge: z.boolean().default(true),
});

/**
 * The audit root: explicit config first, then `$DSH_AUDIT_ROOT`, then
 * `$DSH_HOME/audits`.
 *
 * `resolveDshHome` itself applies the harness-wide precedence (configured →
 * `$DSH_HOME` → `~/.dsh`), so this stays one rule rather than two.
 *
 * @param config - the raw config, defaults not yet applied.
 * @param env - environment to read; injectable for tests.
 */
export function resolveAuditRoot(
  config: SessionAuditConfig = {},
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = config.auditRoot?.trim() ?? "";
  if (configured.length > 0) return resolve(expandHomePath(configured));

  const fromEnv = env[AUDIT_ROOT_ENV]?.trim() ?? "";
  if (fromEnv.length > 0) return resolve(expandHomePath(fromEnv));

  return resolve(resolveDshHome(undefined, env), AUDIT_ROOT_DIRECTORY);
}

/** Apply every default, resolving the root. */
export function resolveConfig(
  config: SessionAuditConfig = {},
  env: Record<string, string | undefined> = process.env,
): ResolvedSessionAuditConfig {
  return {
    enabled: config.enabled ?? true,
    auditRoot: resolveAuditRoot(config, env),
    watch: config.watch ?? true,
    watchMode: config.watchMode ?? "auto",
    settleMs: config.settleMs ?? DEFAULT_SETTLE_MS,
    rescanIntervalMs: config.rescanIntervalMs ?? DEFAULT_RESCAN_INTERVAL_MS,
    allowDirectoryPrefixMatch: config.allowDirectoryPrefixMatch ?? true,
    maxAnalysisBytes: config.maxAnalysisBytes ?? DEFAULT_MAX_ANALYSIS_BYTES,
    maxReportBytes: config.maxReportBytes ?? DEFAULT_MAX_REPORT_BYTES,
    exposeHeaderBadge: config.exposeHeaderBadge ?? true,
  };
}
