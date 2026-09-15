import path from "node:path";
import z from "@deepseek-ai/schemastery";
import {
  bitrix24ConfigSchema,
  resolveBitrix24Config,
  type Bitrix24Flags,
} from "./providers/bitrix24/config.js";
import {
  gitlabConfigSchema,
  resolveGitlabConfig,
  type GitlabFlags,
} from "./providers/gitlab/config.js";
import {
  resolveTeamCityConfig,
  teamcityConfigSchema,
  type TeamCityConfigInput,
  type TeamCityFlags,
} from "./providers/teamcity/config.js";

/**
 * Composition root of the plugin config: the shared knobs plus one slice per
 * provider. Adding a provider means adding its slice here and nothing else.
 */
export interface QaIntegrationsConfig {
  readonly enabled?: boolean;
  readonly dataPath?: string;
  readonly masterKeyPath?: string;
  readonly masterKeyVersion?: number;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  /** Host allowlist for providers that dial an operator-approved domain. */
  readonly allowedPortalSuffixes?: string[];
  readonly bitrix24?: Partial<Bitrix24Flags>;
  readonly gitlab?: Partial<GitlabFlags>;
  readonly teamcity?: TeamCityConfigInput;
}

export interface ResolvedQaIntegrationsConfig {
  readonly enabled: boolean;
  readonly dataPath: string;
  readonly masterKeyPath: string;
  readonly masterKeyVersion: number;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly allowedPortalSuffixes: readonly string[];
  readonly bitrix24: Bitrix24Flags;
  readonly gitlab: GitlabFlags;
  readonly teamcity: TeamCityFlags;
}

export const ConfigSchema: z<QaIntegrationsConfig> = z.object({
  enabled: z.boolean().default(false),
  dataPath: z.string(),
  masterKeyPath: z.string().default("/run/secrets/qa_integrations_master_key"),
  masterKeyVersion: z.number().step(1).min(1).default(1),
  timeoutMs: z.number().step(1).min(1).default(15_000),
  maxResponseBytes: z.number().step(1).min(1).default(2_000_000),
  allowedPortalSuffixes: z
    .array(z.string())
    .default([".bitrix24.ru", ".bitrix24.com", ".bitrix24.eu"]),
  bitrix24: bitrix24ConfigSchema,
  gitlab: gitlabConfigSchema,
  teamcity: teamcityConfigSchema,
});

export function resolveConfig(
  input: QaIntegrationsConfig = {},
): ResolvedQaIntegrationsConfig {
  const dshHome = process.env.DSH_HOME?.trim();
  const base =
    dshHome === undefined || dshHome === "" ? process.cwd() : dshHome;
  const suffixes = (
    input.allowedPortalSuffixes ?? [
      ".bitrix24.ru",
      ".bitrix24.com",
      ".bitrix24.eu",
    ]
  )
    .map((suffix) => suffix.trim().toLowerCase())
    .filter((suffix) => suffix.startsWith(".") && suffix.length > 1);
  return Object.freeze({
    enabled: input.enabled ?? false,
    dataPath: input.dataPath?.trim() || path.join(base, "qa-integrations.json"),
    masterKeyPath:
      input.masterKeyPath?.trim() || "/run/secrets/qa_integrations_master_key",
    masterKeyVersion: input.masterKeyVersion ?? 1,
    timeoutMs: input.timeoutMs ?? 15_000,
    maxResponseBytes: input.maxResponseBytes ?? 2_000_000,
    allowedPortalSuffixes: Object.freeze(suffixes),
    bitrix24: resolveBitrix24Config(input.bitrix24),
    gitlab: resolveGitlabConfig(input.gitlab),
    teamcity: resolveTeamCityConfig(input.teamcity),
  });
}
