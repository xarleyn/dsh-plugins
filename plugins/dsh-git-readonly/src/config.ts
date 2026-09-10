/**
 * Configuration surface of the dsh-git-readonly plugin.
 *
 * The Schemastery schema (`GitReadonlyConfigSchema`) is the user-facing
 * contract exposed through the Cordis named `Config` export;
 * `resolveGitReadonlyConfig` normalizes raw config into fully defaulted,
 * clamped values, so the tools never deal with optional fields or unsafe
 * limits. Every field is documented — this is the deployment contract.
 */

import z from '@deepseek-ai/schemastery';

/** Raw user-facing configuration. */
export interface GitReadonlyConfig {
  /** Master switch; when false the tools are not registered at all. */
  readonly enabled?: boolean;
  /**
   * Git executable to spawn. Defaults to `git` resolved from PATH.
   * Test seam: stub programs are wired through the runner options, not here.
   */
  readonly gitPath?: string;
  /** Wall-clock budget per git invocation, clamped to [1_000, 30_000] ms. */
  readonly timeoutMs?: number;
  readonly history?: {
    /** Page size returned when the model omits `limit` (clamped 1-50). */
    readonly defaultLimit?: number;
    /** Hard upper bound for one history page (clamped 1-200). */
    readonly maxLimit?: number;
  };
  readonly blame?: {
    /** Maximum lines attributed in one call (clamped 1-1_000). */
    readonly maxLines?: number;
  };
  /** Maximum patch bytes returned by `dsh_git_show` (clamped 4 KiB-1 MiB). */
  readonly patchBytes?: number;
}

/** Fully defaulted, clamped configuration used by the tools. */
export interface ResolvedGitReadonlyConfig {
  readonly enabled: boolean;
  readonly gitPath: string;
  readonly timeoutMs: number;
  readonly historyDefaultLimit: number;
  readonly historyMaxLimit: number;
  readonly blameMaxLines: number;
  readonly patchBytes: number;
}

export const GIT_READONLY_DEFAULTS: ResolvedGitReadonlyConfig = {
  enabled: true,
  gitPath: 'git',
  timeoutMs: 15_000,
  historyDefaultLimit: 20,
  historyMaxLimit: 100,
  blameMaxLines: 300,
  patchBytes: 200_000,
};

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export const GitReadonlyConfigSchema: z<GitReadonlyConfig> = z
  .object({
    enabled: z.boolean().default(true).description('Register the read-only git tools.'),
    gitPath: z
      .string()
      .default('git')
      .description('Git executable used for the read-only inspections.'),
    timeoutMs: z
      .number()
      .default(GIT_READONLY_DEFAULTS.timeoutMs)
      .description('Wall-clock budget per git invocation in milliseconds (1000-30000).'),
    history: z
      .object({
        defaultLimit: z
          .number()
          .default(GIT_READONLY_DEFAULTS.historyDefaultLimit)
          .description('History page size when the model omits limit (1-50).'),
        maxLimit: z
          .number()
          .default(GIT_READONLY_DEFAULTS.historyMaxLimit)
          .description('Hard upper bound for one history page (1-200).'),
      })
      .description('Limits for dsh_git_history.'),
    blame: z
      .object({
        maxLines: z
          .number()
          .default(GIT_READONLY_DEFAULTS.blameMaxLines)
          .description('Maximum lines attributed by one dsh_git_blame call (1-1000).'),
      })
      .description('Limits for dsh_git_blame.'),
    patchBytes: z
      .number()
      .default(GIT_READONLY_DEFAULTS.patchBytes)
      .description('Maximum patch bytes returned by dsh_git_show (4096-1048576).'),
  })
  .description('Read-only git provenance tools.');

/** Normalize and clamp raw configuration into the resolved shape. */
export function resolveGitReadonlyConfig(raw?: GitReadonlyConfig | unknown): ResolvedGitReadonlyConfig {
  const config = (raw ?? {}) as GitReadonlyConfig;
  return {
    enabled: config.enabled ?? GIT_READONLY_DEFAULTS.enabled,
    gitPath:
      typeof config.gitPath === 'string' && config.gitPath.trim() !== ''
        ? config.gitPath.trim()
        : GIT_READONLY_DEFAULTS.gitPath,
    timeoutMs: clampInteger(config.timeoutMs, 1_000, 30_000, GIT_READONLY_DEFAULTS.timeoutMs),
    historyDefaultLimit: clampInteger(
      config.history?.defaultLimit,
      1,
      50,
      GIT_READONLY_DEFAULTS.historyDefaultLimit,
    ),
    historyMaxLimit: clampInteger(
      config.history?.maxLimit,
      1,
      200,
      GIT_READONLY_DEFAULTS.historyMaxLimit,
    ),
    blameMaxLines: clampInteger(config.blame?.maxLines, 1, 1_000, GIT_READONLY_DEFAULTS.blameMaxLines),
    patchBytes: clampInteger(config.patchBytes, 4_096, 1_048_576, GIT_READONLY_DEFAULTS.patchBytes),
  };
}
