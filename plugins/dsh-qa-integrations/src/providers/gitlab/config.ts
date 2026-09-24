import z from "@deepseek-ai/schemastery";
import { scopedConfigError } from "../../errors.js";
import { findEndpoint, resolveEndpointList } from "../kernel/address.js";

/**
 * One GitLab deployment the operator allows. A user never types a host: the
 * connect form only picks from this list, so the broker cannot be pointed at an
 * arbitrary origin (the specification's SSRF rule).
 */
export interface GitlabInstance {
  readonly id: string;
  readonly label: string;
  /** Canonical `<origin><path>`, without a trailing slash. */
  readonly baseUrl: string;
}

/**
 * Deployment switches for the GitLab provider. Every read capability is on by
 * default: a capability reaches the agent only when the connected token was
 * actually granted the matching GitLab scope, so these switches bound what this
 * deployment allows, they do not grant it.
 */
export interface GitlabFlags {
  readonly enabled: boolean;
  /** Development escape hatch; production instances must answer over HTTPS. */
  readonly allowInsecureHttp: boolean;
  readonly instances: readonly GitlabInstance[];
  readonly identityRead: boolean;
  readonly projectsRead: boolean;
  readonly repositoryRead: boolean;
  readonly searchRead: boolean;
  readonly issuesRead: boolean;
  readonly mergeRequestsRead: boolean;
  /** Pipeline and job metadata; service-safe, unlike the job log below. */
  readonly ciMetadataRead: boolean;
  /** Job log contents: may carry secrets, never reachable by a service token. */
  readonly ciLogsRead: boolean;
  /** Largest file body handed to the model, in bytes. */
  readonly maxFileBytes: number;
  /** Largest CI job log handed to the model, in bytes. */
  readonly maxJobLogBytes: number;
  /** Result cap for the search operations, which GitLab bounds per page. */
  readonly maxSearchResults: number;
  /** Extra attempts for a rate-limited or transient read; writes never retry. */
  readonly retries: number;
}

export const GITLAB_DEFAULTS: GitlabFlags = Object.freeze({
  enabled: true,
  allowInsecureHttp: false,
  instances: Object.freeze([]),
  identityRead: true,
  projectsRead: true,
  repositoryRead: true,
  searchRead: true,
  issuesRead: true,
  mergeRequestsRead: true,
  ciMetadataRead: true,
  ciLogsRead: true,
  maxFileBytes: 131_072,
  maxJobLogBytes: 262_144,
  maxSearchResults: 50,
  retries: 2,
});

/**
 * Operator input of this slice. `ciRead` is the single CI switch of earlier
 * releases: deployments that set it are read as both halves of the split, so a
 * deployment that had turned CI off does not silently get it back.
 */
export type GitlabConfigInput = Partial<GitlabFlags> & {
  readonly ciRead?: boolean;
};

const configError = scopedConfigError("gitlab integration config");

/**
 * The instance list as the operator writes it, validated and canonicalized by
 * the shared address policy: id grammar, HTTPS rule, credential-free absolute
 * URL, trailing-slash folding.
 */
function normalizeInstances(
  input: unknown,
  allowInsecureHttp: boolean,
): readonly GitlabInstance[] {
  return resolveEndpointList(input, allowInsecureHttp, {
    error: configError,
    field: "instances",
    noun: "instance",
  });
}

/**
 * Config slice of this provider, as it appears under `gitlab:` in YAML. The
 * instance list is validated and canonicalized by `resolveGitlabConfig`, which
 * is where a deployment typo fails loudly.
 */
export const gitlabConfigSchema = z.object({
  enabled: z.boolean().default(GITLAB_DEFAULTS.enabled),
  allowInsecureHttp: z.boolean().default(GITLAB_DEFAULTS.allowInsecureHttp),
  instances: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        baseUrl: z.string(),
      }),
    )
    .default([]),
  identityRead: z.boolean().default(GITLAB_DEFAULTS.identityRead),
  projectsRead: z.boolean().default(GITLAB_DEFAULTS.projectsRead),
  repositoryRead: z.boolean().default(GITLAB_DEFAULTS.repositoryRead),
  searchRead: z.boolean().default(GITLAB_DEFAULTS.searchRead),
  issuesRead: z.boolean().default(GITLAB_DEFAULTS.issuesRead),
  mergeRequestsRead: z.boolean().default(GITLAB_DEFAULTS.mergeRequestsRead),
  ciMetadataRead: z.boolean().default(GITLAB_DEFAULTS.ciMetadataRead),
  ciLogsRead: z.boolean().default(GITLAB_DEFAULTS.ciLogsRead),
  ciRead: z.boolean().required(false),
  maxFileBytes: z
    .number()
    .step(1)
    .min(1_024)
    .default(GITLAB_DEFAULTS.maxFileBytes),
  maxJobLogBytes: z
    .number()
    .step(1)
    .min(1_024)
    .default(GITLAB_DEFAULTS.maxJobLogBytes),
  maxSearchResults: z
    .number()
    .step(1)
    .min(1)
    .max(100)
    .default(GITLAB_DEFAULTS.maxSearchResults),
  retries: z.number().step(1).min(0).max(5).default(GITLAB_DEFAULTS.retries),
}) as unknown as z<GitlabConfigInput>;

export function resolveGitlabConfig(
  input: GitlabConfigInput = {},
): GitlabFlags {
  const allowInsecureHttp =
    input.allowInsecureHttp ?? GITLAB_DEFAULTS.allowInsecureHttp;
  // The pre-split single switch still governs both halves when it is the only
  // one set, which keeps an operator's earlier "CI off" decision intact.
  const ciMetadataRead =
    input.ciMetadataRead ?? input.ciRead ?? GITLAB_DEFAULTS.ciMetadataRead;
  const ciLogsRead =
    input.ciLogsRead ?? input.ciRead ?? GITLAB_DEFAULTS.ciLogsRead;
  return Object.freeze({
    enabled: input.enabled ?? GITLAB_DEFAULTS.enabled,
    allowInsecureHttp,
    instances: normalizeInstances(input.instances, allowInsecureHttp),
    identityRead: input.identityRead ?? GITLAB_DEFAULTS.identityRead,
    projectsRead: input.projectsRead ?? GITLAB_DEFAULTS.projectsRead,
    repositoryRead: input.repositoryRead ?? GITLAB_DEFAULTS.repositoryRead,
    searchRead: input.searchRead ?? GITLAB_DEFAULTS.searchRead,
    issuesRead: input.issuesRead ?? GITLAB_DEFAULTS.issuesRead,
    mergeRequestsRead:
      input.mergeRequestsRead ?? GITLAB_DEFAULTS.mergeRequestsRead,
    ciMetadataRead,
    ciLogsRead,
    maxFileBytes: input.maxFileBytes ?? GITLAB_DEFAULTS.maxFileBytes,
    maxJobLogBytes: input.maxJobLogBytes ?? GITLAB_DEFAULTS.maxJobLogBytes,
    maxSearchResults:
      input.maxSearchResults ?? GITLAB_DEFAULTS.maxSearchResults,
    retries: input.retries ?? GITLAB_DEFAULTS.retries,
  });
}

/** The configured instance a stored credential names, or undefined. */
export function gitlabInstance(
  flags: GitlabFlags,
  instanceId: string,
): GitlabInstance | undefined {
  return findEndpoint(flags.instances, instanceId);
}
