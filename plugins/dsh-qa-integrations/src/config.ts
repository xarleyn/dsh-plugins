import path from "node:path";
import type { Volatile } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { CredentialHelpOverride } from "@yadsh/dsh-plugin-kit";
import {
  bitrix24ConfigSchema,
  resolveBitrix24Config,
  type Bitrix24Flags,
} from "./providers/bitrix24/config.js";
import {
  confluenceConfigSchema,
  resolveConfluenceConfig,
  type ConfluenceConfigInput,
  type ConfluenceFlags,
} from "./providers/confluence/config.js";
import {
  gitlabConfigSchema,
  resolveGitlabConfig,
  type GitlabFlags,
} from "./providers/gitlab/config.js";
import {
  jiraConfigSchema,
  resolveJiraConfig,
  type JiraConfigInput,
  type JiraFlags,
} from "./providers/jira/config.js";
import {
  resolveTeamCityConfig,
  teamcityConfigSchema,
  type TeamCityConfigInput,
  type TeamCityFlags,
} from "./providers/teamcity/config.js";
import {
  resolveTestitConfig,
  testitConfigSchema,
  type TestitFlags,
} from "./providers/testit/config.js";
import {
  resolveWeblateConfig,
  weblateConfigSchema,
  type WeblateFlags,
} from "./providers/weblate/config.js";
import { credentialHelpOverridesSchema } from "./providers/shared/credential-help.js";
import {
  managedServiceCredentialsSchema,
  resolveManagedServiceCredentials,
  type ManagedServiceCredentialsConfig,
  type ManagedServiceCredentialsInput,
} from "./service-credentials/config.js";

/**
 * Composition root of the plugin config: the shared knobs plus one slice per
 * provider. Adding a provider means adding its slice here and nothing else.
 */
export interface QaIntegrationsConfig {
  readonly enabled?: boolean;
  readonly dataPath?: string;
  /**
   * How long the audit trail is kept. Rows older than this are dropped as the
   * log is written, and a hard row cap applies whatever this says.
   */
  readonly auditRetentionDays?: number;
  readonly masterKeyPath?: string;
  readonly masterKeyVersion?: number;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  /** Host allowlist for providers that dial an operator-approved domain. */
  readonly allowedPortalSuffixes?: string[];
  /**
   * Deployment replacements for the credential help each provider declares:
   * corporate token pages, self-hosted instances, internal documentation. A
   * provider without an entry keeps the help it ships.
   */
  readonly credentialHelp?: Readonly<Record<string, CredentialHelpOverride>>;
  readonly bitrix24?: Partial<Bitrix24Flags>;
  readonly confluence?: ConfluenceConfigInput;
  readonly gitlab?: Partial<GitlabFlags>;
  readonly teamcity?: TeamCityConfigInput;
  readonly jira?: JiraConfigInput;
  readonly testit?: Partial<TestitFlags>;
  readonly weblate?: Partial<WeblateFlags>;
  /**
   * Deployment-managed service credentials. Absent by default: a deployment
   * opts in, and nothing about the feature exists until it does.
   */
  readonly managedServiceCredentials?: ManagedServiceCredentialsInput;
}

/**
 * One read of a live entry's configuration. Every key of {@link
 * QaIntegrationsConfig} is present, and a reference that holds no value reads
 * as `undefined` — the resolvers already treat absence and `undefined` alike,
 * and a snapshot cannot tell them apart because a volatile reference carries
 * only the committed value.
 */
export type QaIntegrationsSnapshot = {
  readonly [Key in keyof QaIntegrationsConfig]?:
    | QaIntegrationsConfig[Key]
    | undefined;
};

export interface ResolvedQaIntegrationsConfig {
  readonly enabled: boolean;
  readonly dataPath: string;
  readonly auditRetentionDays: number;
  readonly masterKeyPath: string;
  readonly masterKeyVersion: number;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly allowedPortalSuffixes: readonly string[];
  readonly credentialHelp: Readonly<
    Record<string, CredentialHelpOverride | undefined>
  >;
  readonly bitrix24: Bitrix24Flags;
  readonly confluence: ConfluenceFlags;
  readonly gitlab: GitlabFlags;
  readonly teamcity: TeamCityFlags;
  readonly jira: JiraFlags;
  readonly testit: TestitFlags;
  readonly weblate: WeblateFlags;
  readonly managedServiceCredentials: ManagedServiceCredentialsConfig;
}

/**
 * The configuration as the running plugin receives it. On a 0.1.7 host a
 * field the operator card edits is a stable reference rather than its value,
 * so the service reads it once per operation and never waits for a remount;
 * `QaIntegrationsConfig` above stays the plain data shape the resolvers and
 * the card work with. Every field is volatile because every knob the
 * resolvers accept is reachable from this card — the boot-path files among
 * them, whose edit the Host accepts and applies on the next restart.
 */
export interface LiveQaIntegrationsConfig {
  readonly enabled: Volatile<boolean>;
  readonly dataPath: Volatile<string | undefined>;
  readonly auditRetentionDays: Volatile<number>;
  readonly masterKeyPath: Volatile<string>;
  readonly masterKeyVersion: Volatile<number>;
  readonly timeoutMs: Volatile<number>;
  readonly maxResponseBytes: Volatile<number>;
  readonly allowedPortalSuffixes: Volatile<string[] | undefined>;
  readonly credentialHelp: Volatile<
    Readonly<Record<string, CredentialHelpOverride>> | undefined
  >;
  readonly bitrix24: Volatile<Partial<Bitrix24Flags> | undefined>;
  readonly confluence: Volatile<ConfluenceConfigInput | undefined>;
  readonly gitlab: Volatile<Partial<GitlabFlags> | undefined>;
  readonly teamcity: Volatile<TeamCityConfigInput | undefined>;
  readonly jira: Volatile<JiraConfigInput | undefined>;
  readonly testit: Volatile<Partial<TestitFlags> | undefined>;
  readonly weblate: Volatile<Partial<WeblateFlags> | undefined>;
  readonly managedServiceCredentials: Volatile<
    ManagedServiceCredentialsInput | undefined
  >;
}

export const ConfigSchema: z<QaIntegrationsConfig, LiveQaIntegrationsConfig> =
  z.object({
    enabled: z.boolean().default(false).volatile(),
    dataPath: z.string().volatile(),
    auditRetentionDays: z
      .number()
      .step(1)
      .min(0)
      .max(3_650)
      .default(90)
      .volatile(),
    masterKeyPath: z
      .string()
      .default("/run/secrets/qa_integrations_master_key")
      .volatile(),
    masterKeyVersion: z.number().step(1).min(1).default(1).volatile(),
    timeoutMs: z.number().step(1).min(1).default(15_000).volatile(),
    maxResponseBytes: z
      .number()
      .step(1)
      .min(1)
      .default(2_000_000)
      .volatile(),
    allowedPortalSuffixes: z
      .array(z.string())
      .default([".bitrix24.ru", ".bitrix24.com", ".bitrix24.eu"])
      .volatile(),
    credentialHelp: credentialHelpOverridesSchema.volatile(),
    bitrix24: bitrix24ConfigSchema.volatile(),
    confluence: confluenceConfigSchema.volatile(),
    gitlab: gitlabConfigSchema.volatile(),
    teamcity: teamcityConfigSchema.volatile(),
    jira: jiraConfigSchema.volatile(),
    testit: testitConfigSchema.volatile(),
    weblate: weblateConfigSchema.volatile(),
    managedServiceCredentials: managedServiceCredentialsSchema.volatile(),
  });

/**
 * Read one configuration reference. The Loader commits a card edit into the
 * entry's own references, and a resolved volatile node is always a reference —
 * even for a plugin started through `ctx.plugin()` — so the plain shape is
 * taken from the snapshot the reference holds.
 */
function read<T>(field: Volatile<T>): T {
  return field.get() as T;
}

/**
 * Take the live configuration as one plain value, for a single operation.
 *
 * Each read of a volatile field sees the value committed since the last one,
 * so a caller snapshots once per operation instead of destructuring at mount:
 * a snapshot kept across operations would freeze an operator's edit out.
 */
export function snapshotConfig(
  config: LiveQaIntegrationsConfig,
): QaIntegrationsSnapshot {
  return {
    enabled: read(config.enabled),
    dataPath: read(config.dataPath),
    auditRetentionDays: read(config.auditRetentionDays),
    masterKeyPath: read(config.masterKeyPath),
    masterKeyVersion: read(config.masterKeyVersion),
    timeoutMs: read(config.timeoutMs),
    maxResponseBytes: read(config.maxResponseBytes),
    allowedPortalSuffixes: read(config.allowedPortalSuffixes),
    credentialHelp: read(config.credentialHelp),
    bitrix24: read(config.bitrix24),
    confluence: read(config.confluence),
    gitlab: read(config.gitlab),
    teamcity: read(config.teamcity),
    jira: read(config.jira),
    testit: read(config.testit),
    weblate: read(config.weblate),
    managedServiceCredentials: read(config.managedServiceCredentials),
  };
}

export function resolveConfig(
  input: QaIntegrationsSnapshot = {},
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
    dataPath: input.dataPath?.trim() || path.join(base, "qa-integrations.db"),
    auditRetentionDays: input.auditRetentionDays ?? 90,
    masterKeyPath:
      input.masterKeyPath?.trim() || "/run/secrets/qa_integrations_master_key",
    masterKeyVersion: input.masterKeyVersion ?? 1,
    timeoutMs: input.timeoutMs ?? 15_000,
    maxResponseBytes: input.maxResponseBytes ?? 2_000_000,
    allowedPortalSuffixes: Object.freeze(suffixes),
    credentialHelp: Object.freeze({ ...input.credentialHelp }),
    bitrix24: resolveBitrix24Config(input.bitrix24),
    confluence: resolveConfluenceConfig(input.confluence),
    gitlab: resolveGitlabConfig(input.gitlab),
    teamcity: resolveTeamCityConfig(input.teamcity),
    jira: resolveJiraConfig(input.jira),
    testit: resolveTestitConfig(input.testit),
    weblate: resolveWeblateConfig(input.weblate),
    managedServiceCredentials: resolveManagedServiceCredentials(
      input.managedServiceCredentials,
    ),
  });
}
