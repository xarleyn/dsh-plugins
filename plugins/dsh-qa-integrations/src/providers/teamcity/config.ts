import z from "@deepseek-ai/schemastery";
import {
  PRIVATE_CIDRS,
  canonicalServerUrl,
  cidrProblem,
  hostPatternProblem,
  serverUrlProblem,
  type TeamCityNetworkMode,
  type TeamCityNetworkPolicy,
} from "./network.js";

/**
 * Deployment switches for the TeamCity provider. A read capability reaches the
 * agent only when this deployment enables it, and the connected token can still
 * be narrower: TeamCity enforces its own permissions on every request, and a
 * refusal is reported instead of being worked around.
 */
export interface TeamCityFlags {
  readonly enabled: boolean;
  /**
   * The one TeamCity server this deployment dials, canonical `<origin><path>`,
   * or `""` when the operator mounted none. It is operator configuration and
   * never user input: every user connects *there* with their own token, which
   * is what keeps the broker from being pointed at a host of the caller's
   * choosing.
   */
  readonly serverUrl: string;
  /** Which addresses this deployment may dial at all. */
  readonly network: TeamCityNetworkPolicy;
  readonly identityRead: boolean;
  readonly projectsRead: boolean;
  readonly buildConfigsRead: boolean;
  readonly buildsRead: boolean;
  readonly failuresRead: boolean;
  readonly logsRead: boolean;
  readonly queueRead: boolean;
  readonly investigationsRead: boolean;
  readonly agentsRead: boolean;
  readonly artifactsRead: boolean;
  /** Hard ceiling for one build log answer, in lines. */
  readonly maxLogLines: number;
  /** How much of a build log is downloaded before the window is selected. */
  readonly maxLogBytes: number;
  /** Byte budget of one text artifact when the caller names none. */
  readonly defaultArtifactBytes: number;
  /** Hard ceiling of one text artifact, whatever the caller asks for. */
  readonly maxArtifactBytes: number;
  /** Timeout for the streaming reads; JSON reads use the shared one. */
  readonly streamTimeoutMs: number;
  /** Extra attempts for a throttled or transient read. */
  readonly retries: number;
}

/** Config slice as YAML writes it: every member is optional there. */
export interface TeamCityConfigInput extends Partial<
  Omit<TeamCityFlags, "network">
> {
  readonly network?: Partial<TeamCityNetworkPolicy> | undefined;
}

const DEFAULT_NETWORK: TeamCityNetworkPolicy = Object.freeze({
  mode: "allowlist" as const,
  allowedHosts: Object.freeze([]),
  allowedCidrs: Object.freeze([]),
  allowedPorts: Object.freeze([]),
  allowHttp: false,
});

export const TEAMCITY_DEFAULTS: TeamCityFlags = Object.freeze({
  enabled: true,
  serverUrl: "",
  network: DEFAULT_NETWORK,
  identityRead: true,
  projectsRead: true,
  buildConfigsRead: true,
  buildsRead: true,
  failuresRead: true,
  logsRead: true,
  queueRead: true,
  investigationsRead: true,
  agentsRead: true,
  artifactsRead: true,
  maxLogLines: 1_000,
  maxLogBytes: 262_144,
  defaultArtifactBytes: 262_144,
  maxArtifactBytes: 1_048_576,
  streamTimeoutMs: 30_000,
  retries: 2,
});

const NETWORK_MODES: readonly TeamCityNetworkMode[] = [
  "allowlist",
  "trusted-private",
];

/** One log answer is a window, so its line count and byte budget are both small. */
export const DEFAULT_LOG_LINES = 200;

function configError(message: string): Error {
  return new Error(`teamcity integration config: ${message}`);
}

function stringList(input: unknown, field: string): readonly string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw configError(`${field} must be a list`);
  return input.map((item) => {
    if (typeof item !== "string") {
      throw configError(`${field} must contain strings only`);
    }
    return item.trim().toLowerCase();
  });
}

function portList(input: unknown): readonly number[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw configError("allowedPorts must be a list");
  return input.map((item) => {
    if (!Number.isInteger(item) || Number(item) < 1 || Number(item) > 65_535) {
      throw configError("allowedPorts must contain TCP port numbers");
    }
    return Number(item);
  });
}

/**
 * Canonicalize the address policy. Everything here is operator input, so a typo
 * must fail loudly at load: a silently ignored host pattern would leave users
 * with a provider that refuses every address and no explanation.
 */
function resolveNetwork(
  input: Partial<TeamCityNetworkPolicy> | undefined,
): TeamCityNetworkPolicy {
  const mode = input?.mode ?? DEFAULT_NETWORK.mode;
  if (!NETWORK_MODES.includes(mode)) {
    throw configError(
      `network.mode must be one of ${NETWORK_MODES.join(", ")}`,
    );
  }
  const allowedHosts = stringList(input?.allowedHosts, "network.allowedHosts");
  for (const pattern of allowedHosts) {
    const problem = hostPatternProblem(pattern);
    if (problem !== undefined) {
      throw configError(`network.allowedHosts: ${problem} (${pattern})`);
    }
  }
  const allowedCidrs = stringList(input?.allowedCidrs, "network.allowedCidrs");
  for (const cidr of allowedCidrs) {
    const problem = cidrProblem(cidr);
    if (problem !== undefined) {
      throw configError(`network.allowedCidrs: ${problem} (${cidr})`);
    }
  }
  const allowHttp = input?.allowHttp ?? DEFAULT_NETWORK.allowHttp;
  const allowedPorts = portList(input?.allowedPorts);
  const trusted = mode === "trusted-private";
  return Object.freeze({
    mode,
    allowedHosts: Object.freeze(allowedHosts),
    allowedCidrs: Object.freeze(
      trusted && allowedCidrs.length === 0 ? [...PRIVATE_CIDRS] : allowedCidrs,
    ),
    // Plain HTTP on a non-default port is usually a lab server, so the port the
    // scheme implies is always allowed and the operator adds the rest.
    allowedPorts: Object.freeze(
      allowedPorts.length > 0 ? allowedPorts : [allowHttp ? 80 : 443],
    ),
    allowHttp,
  });
}

/**
 * Canonicalize the address this deployment dials. Everything here is operator
 * input, so a typo must fail loudly at load: an address the policy refuses
 * anyway would leave every user with a form that cannot be saved and no
 * explanation. An empty value is deliberately not an error — the plugin has to
 * load in a deployment that mounts no TeamCity yet, and the card says so
 * instead of offering a form.
 */
function resolveServerUrl(
  input: string | undefined,
  network: TeamCityNetworkPolicy,
): string {
  const raw = (input ?? "").trim();
  if (raw === "") return "";
  const problem = serverUrlProblem(raw, network);
  if (problem !== undefined) throw configError(`serverUrl: ${problem}`);
  return canonicalServerUrl(raw);
}

/**
 * True when the policy dials nothing at all. That is the default, and it is
 * deliberately not an error: the plugin has to load in a deployment that mounts
 * no TeamCity yet. The plugin logs it once at startup, so an operator who
 * enabled the provider and forgot the address list hears about it there rather
 * than from a user whose connect form refuses every address.
 */
export function networkAllowsNothing(policy: TeamCityNetworkPolicy): boolean {
  return (
    policy.mode === "allowlist" &&
    policy.allowedHosts.length === 0 &&
    policy.allowedCidrs.length === 0
  );
}

/**
 * Config slice of this provider, as it appears under `teamcity:` in YAML. The
 * address policy is declared with plain types here and validated by
 * `resolveTeamCityConfig`, which is where a deployment typo fails loudly.
 */
export const teamcityConfigSchema = z
  .object({
    enabled: z.boolean().default(TEAMCITY_DEFAULTS.enabled),
    serverUrl: z.string().default(TEAMCITY_DEFAULTS.serverUrl),
    network: z
      .object({
        mode: z.string().default(DEFAULT_NETWORK.mode),
        allowedHosts: z.array(z.string()).default([]),
        allowedCidrs: z.array(z.string()).default([]),
        allowedPorts: z.array(z.number()).default([]),
        allowHttp: z.boolean().default(DEFAULT_NETWORK.allowHttp),
      })
      .default({
        mode: DEFAULT_NETWORK.mode,
        allowedHosts: [],
        allowedCidrs: [],
        allowedPorts: [],
        allowHttp: DEFAULT_NETWORK.allowHttp,
      }),
    identityRead: z.boolean().default(TEAMCITY_DEFAULTS.identityRead),
    projectsRead: z.boolean().default(TEAMCITY_DEFAULTS.projectsRead),
    buildConfigsRead: z.boolean().default(TEAMCITY_DEFAULTS.buildConfigsRead),
    buildsRead: z.boolean().default(TEAMCITY_DEFAULTS.buildsRead),
    failuresRead: z.boolean().default(TEAMCITY_DEFAULTS.failuresRead),
    logsRead: z.boolean().default(TEAMCITY_DEFAULTS.logsRead),
    queueRead: z.boolean().default(TEAMCITY_DEFAULTS.queueRead),
    investigationsRead: z
      .boolean()
      .default(TEAMCITY_DEFAULTS.investigationsRead),
    agentsRead: z.boolean().default(TEAMCITY_DEFAULTS.agentsRead),
    artifactsRead: z.boolean().default(TEAMCITY_DEFAULTS.artifactsRead),
    maxLogLines: z
      .number()
      .step(1)
      .min(1)
      .default(TEAMCITY_DEFAULTS.maxLogLines),
    maxLogBytes: z
      .number()
      .step(1)
      .min(1_024)
      .default(TEAMCITY_DEFAULTS.maxLogBytes),
    defaultArtifactBytes: z
      .number()
      .step(1)
      .min(1_024)
      .default(TEAMCITY_DEFAULTS.defaultArtifactBytes),
    maxArtifactBytes: z
      .number()
      .step(1)
      .min(1_024)
      .default(TEAMCITY_DEFAULTS.maxArtifactBytes),
    streamTimeoutMs: z
      .number()
      .step(1)
      .min(1_000)
      .default(TEAMCITY_DEFAULTS.streamTimeoutMs),
    retries: z
      .number()
      .step(1)
      .min(0)
      .max(5)
      .default(TEAMCITY_DEFAULTS.retries),
  })
  // The schema declares types and defaults; `resolveTeamCityConfig` re-validates
  // the address policy, which is where a deployment typo fails loudly.
  .default({
    enabled: TEAMCITY_DEFAULTS.enabled,
    serverUrl: TEAMCITY_DEFAULTS.serverUrl,
    network: {
      mode: DEFAULT_NETWORK.mode,
      allowedHosts: [],
      allowedCidrs: [],
      allowedPorts: [],
      allowHttp: DEFAULT_NETWORK.allowHttp,
    },
    identityRead: TEAMCITY_DEFAULTS.identityRead,
    projectsRead: TEAMCITY_DEFAULTS.projectsRead,
    buildConfigsRead: TEAMCITY_DEFAULTS.buildConfigsRead,
    buildsRead: TEAMCITY_DEFAULTS.buildsRead,
    failuresRead: TEAMCITY_DEFAULTS.failuresRead,
    logsRead: TEAMCITY_DEFAULTS.logsRead,
    queueRead: TEAMCITY_DEFAULTS.queueRead,
    investigationsRead: TEAMCITY_DEFAULTS.investigationsRead,
    agentsRead: TEAMCITY_DEFAULTS.agentsRead,
    artifactsRead: TEAMCITY_DEFAULTS.artifactsRead,
    maxLogLines: TEAMCITY_DEFAULTS.maxLogLines,
    maxLogBytes: TEAMCITY_DEFAULTS.maxLogBytes,
    defaultArtifactBytes: TEAMCITY_DEFAULTS.defaultArtifactBytes,
    maxArtifactBytes: TEAMCITY_DEFAULTS.maxArtifactBytes,
    streamTimeoutMs: TEAMCITY_DEFAULTS.streamTimeoutMs,
    retries: TEAMCITY_DEFAULTS.retries,
  }) as unknown as z<TeamCityConfigInput>;

export function resolveTeamCityConfig(
  input: TeamCityConfigInput = {},
): TeamCityFlags {
  const maxLogLines = input.maxLogLines ?? TEAMCITY_DEFAULTS.maxLogLines;
  const maxLogBytes = input.maxLogBytes ?? TEAMCITY_DEFAULTS.maxLogBytes;
  if (maxLogLines < 1) throw configError("maxLogLines must be positive");
  if (maxLogBytes < 1_024) throw configError("maxLogBytes is too small");
  const defaultArtifactBytes =
    input.defaultArtifactBytes ?? TEAMCITY_DEFAULTS.defaultArtifactBytes;
  const maxArtifactBytes =
    input.maxArtifactBytes ?? TEAMCITY_DEFAULTS.maxArtifactBytes;
  if (defaultArtifactBytes > maxArtifactBytes) {
    throw configError("defaultArtifactBytes must not exceed maxArtifactBytes");
  }
  const network = resolveNetwork(input.network);
  return Object.freeze({
    enabled: input.enabled ?? TEAMCITY_DEFAULTS.enabled,
    serverUrl: resolveServerUrl(input.serverUrl, network),
    network,
    identityRead: input.identityRead ?? TEAMCITY_DEFAULTS.identityRead,
    projectsRead: input.projectsRead ?? TEAMCITY_DEFAULTS.projectsRead,
    buildConfigsRead:
      input.buildConfigsRead ?? TEAMCITY_DEFAULTS.buildConfigsRead,
    buildsRead: input.buildsRead ?? TEAMCITY_DEFAULTS.buildsRead,
    failuresRead: input.failuresRead ?? TEAMCITY_DEFAULTS.failuresRead,
    logsRead: input.logsRead ?? TEAMCITY_DEFAULTS.logsRead,
    queueRead: input.queueRead ?? TEAMCITY_DEFAULTS.queueRead,
    investigationsRead:
      input.investigationsRead ?? TEAMCITY_DEFAULTS.investigationsRead,
    agentsRead: input.agentsRead ?? TEAMCITY_DEFAULTS.agentsRead,
    artifactsRead: input.artifactsRead ?? TEAMCITY_DEFAULTS.artifactsRead,
    maxLogLines,
    maxLogBytes,
    defaultArtifactBytes,
    maxArtifactBytes,
    streamTimeoutMs: input.streamTimeoutMs ?? TEAMCITY_DEFAULTS.streamTimeoutMs,
    retries: input.retries ?? TEAMCITY_DEFAULTS.retries,
  });
}
