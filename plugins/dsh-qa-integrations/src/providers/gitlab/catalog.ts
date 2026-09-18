import type { OperationSecurityMetadata } from "../../service-credentials/types.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
} from "../../types.js";
import type { GitlabFlags } from "./config.js";

/**
 * Capabilities this provider offers. They are narrower than GitLab's own token
 * scopes on purpose: GitLab has one broad read scope per area, while the agent
 * gets one switch per kind of data, and the operator decides what a deployment
 * is willing to expose at all.
 *
 * `scopes` lists the GitLab scopes that satisfy a capability; the provider
 * intersects them with the scopes the connected token actually reports. A token
 * with `read_api` satisfies everything readable, `read_repository` adds nothing
 * on top of it, and `read_user` is enough only for the profile.
 *
 * CI is split in two because a job log is a different disclosure from a
 * pipeline listing: the deployment-managed read-only credential may see which
 * jobs ran and how they ended, never what they printed.
 */
export type GitlabCapability =
  | "identity.read"
  | "projects.read"
  | "repository.read"
  | "search.read"
  | "issues.read"
  | "merge_requests.read"
  | "ci.metadata.read"
  | "ci.logs.read";

export interface GitlabCapabilityDefinition {
  readonly capability: GitlabCapability;
  readonly flag: Exclude<
    keyof GitlabFlags,
    "instances" | "retries" | "enabled" | "allowInsecureHttp"
  >;
  readonly scopes: readonly string[];
  readonly label: string;
  readonly hint: string;
}

export const GITLAB_CAPABILITIES: readonly GitlabCapabilityDefinition[] =
  Object.freeze([
    {
      capability: "identity.read",
      flag: "identityRead",
      scopes: ["read_user", "read_api", "api"],
      label: "Свой профиль",
      hint: "Подключённый пользователь GitLab: логин, имя, адрес инстанса",
    },
    {
      capability: "projects.read",
      flag: "projectsRead",
      scopes: ["read_api", "api"],
      label: "Читать проекты",
      hint: "Поиск проектов, карточка проекта, видимость, ветка по умолчанию",
    },
    {
      capability: "repository.read",
      flag: "repositoryRead",
      scopes: ["read_repository", "read_api", "api"],
      label: "Читать репозитории",
      hint: "Дерево файлов, чтение файлов, коммиты, сравнение веток",
    },
    {
      capability: "search.read",
      flag: "searchRead",
      scopes: ["read_api", "api"],
      label: "Искать по GitLab",
      hint: "Поиск по проектам, задачам, merge requests, коммитам и коду",
    },
    {
      capability: "issues.read",
      flag: "issuesRead",
      scopes: ["read_api", "api"],
      label: "Читать задачи",
      hint: "Список и карточка issue, комментарии к задаче",
    },
    {
      capability: "merge_requests.read",
      flag: "mergeRequestsRead",
      scopes: ["read_api", "api"],
      label: "Читать merge requests",
      hint: "Список и карточка MR, изменённые файлы, обсуждения, одобрения, пайплайны MR",
    },
    {
      capability: "ci.metadata.read",
      flag: "ciMetadataRead",
      scopes: ["read_api", "api"],
      label: "Читать CI/CD",
      hint: "Пайплайны, джобы пайплайна, статусы и метаданные джоба",
    },
    {
      capability: "ci.logs.read",
      flag: "ciLogsRead",
      scopes: ["read_api", "api"],
      label: "Читать лог джоба",
      hint: "Содержимое лога CI-джоба: может содержать секреты и внутренние адреса",
    },
  ]);

/** A read of the connected identity alone: no resource, nothing personal. */
const IDENTITY_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: false,
} as const satisfies OperationSecurityMetadata;

/**
 * A read whose answer belongs to a project. `requiresResourceBoundary` makes the
 * broker prove the profile bounds projects at all, and the provider holds the
 * call inside the boundary — which is what a service account needs, because it
 * can see far more than the user it stands in for.
 */
const PROJECT_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

/**
 * A read that can carry secrets, internal addresses or other people's output.
 * It stays a read, so a personal credential reaches it normally; the managed
 * credential never does, because a shared account must not hand one user what
 * another left in a log.
 */
const SENSITIVE_READ = {
  effect: "read",
  sensitivity: "sensitive",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

export interface GitlabOperationDefinition {
  readonly capability: GitlabCapability;
  /**
   * REST path under the instance's `/api/v4` root. `:placeholders` are filled
   * by the handler; the value is a fixed string, so the model can never pick an
   * endpoint of its own.
   */
  readonly path: string;
  /** Set when the operation answers with one page of a collection. */
  readonly list?: boolean;
  /** What this operation does, how sensitive it is, who may reach it. */
  readonly security: OperationSecurityMetadata;
}

/** The resource kind every project-scoped operation of this provider is bounded by. */
export const GITLAB_RESOURCE_KIND = "projects";

/**
 * Every model-reachable operation. The provider refuses any operation that is
 * not listed here, so this table — together with `capability` and `security` —
 * is the permission surface. Only GET: the catalog carries no operation that
 * could change GitLab state, and the confirmation framework does not exist yet.
 */
export const GITLAB_OPERATIONS: Readonly<
  Record<string, GitlabOperationDefinition>
> = Object.freeze({
  "connection.get": {
    capability: "identity.read",
    path: "/user",
    security: IDENTITY_READ,
  },
  "projects.list": {
    capability: "projects.read",
    path: "/projects",
    list: true,
    security: PROJECT_READ,
  },
  "projects.get": {
    capability: "projects.read",
    path: "/projects/:project",
    security: PROJECT_READ,
  },
  "repository.tree": {
    capability: "repository.read",
    path: "/projects/:project/repository/tree",
    list: true,
    security: PROJECT_READ,
  },
  "repository.file": {
    capability: "repository.read",
    path: "/projects/:project/repository/files/:path",
    security: PROJECT_READ,
  },
  "repository.commits": {
    capability: "repository.read",
    path: "/projects/:project/repository/commits",
    list: true,
    security: PROJECT_READ,
  },
  "repository.commit": {
    capability: "repository.read",
    // `stats` asks GitLab for the diff line counts of the single commit.
    path: "/projects/:project/repository/commits/:sha",
    security: PROJECT_READ,
  },
  "repository.compare": {
    capability: "repository.read",
    path: "/projects/:project/repository/compare",
    security: PROJECT_READ,
  },
  "search.run": {
    capability: "search.read",
    path: "/search",
    list: true,
    security: PROJECT_READ,
  },
  "issues.list": {
    capability: "issues.read",
    path: "/issues",
    list: true,
    security: PROJECT_READ,
  },
  "issues.get": {
    capability: "issues.read",
    path: "/projects/:project/issues/:iid",
    security: PROJECT_READ,
  },
  "issues.notes": {
    capability: "issues.read",
    path: "/projects/:project/issues/:iid/notes",
    list: true,
    security: PROJECT_READ,
  },
  "mergeRequests.list": {
    capability: "merge_requests.read",
    path: "/merge_requests",
    list: true,
    security: PROJECT_READ,
  },
  "mergeRequests.get": {
    capability: "merge_requests.read",
    path: "/projects/:project/merge_requests/:iid",
    security: PROJECT_READ,
  },
  /**
   * Since GitLab 15.7 the single-merge-request `changes` endpoint is deprecated
   * in favour of the paginated `diffs` one, so the operation keeps the
   * specification's name and reads the endpoint GitLab still maintains.
   */
  "mergeRequests.changes": {
    capability: "merge_requests.read",
    path: "/projects/:project/merge_requests/:iid/diffs",
    list: true,
    security: PROJECT_READ,
  },
  "mergeRequests.discussions": {
    capability: "merge_requests.read",
    path: "/projects/:project/merge_requests/:iid/discussions",
    list: true,
    security: PROJECT_READ,
  },
  "mergeRequests.approvals": {
    capability: "merge_requests.read",
    path: "/projects/:project/merge_requests/:iid/approvals",
    security: PROJECT_READ,
  },
  "mergeRequests.pipelines": {
    capability: "merge_requests.read",
    path: "/projects/:project/merge_requests/:iid/pipelines",
    list: true,
    security: PROJECT_READ,
  },
  "pipelines.list": {
    capability: "ci.metadata.read",
    path: "/projects/:project/pipelines",
    list: true,
    security: PROJECT_READ,
  },
  "pipelines.get": {
    capability: "ci.metadata.read",
    path: "/projects/:project/pipelines/:pipelineId",
    security: PROJECT_READ,
  },
  "pipelines.jobs": {
    capability: "ci.metadata.read",
    path: "/projects/:project/pipelines/:pipelineId/jobs",
    list: true,
    security: PROJECT_READ,
  },
  "jobs.get": {
    capability: "ci.metadata.read",
    path: "/projects/:project/jobs/:jobId",
    security: PROJECT_READ,
  },
  /**
   * The job log is the one CI read that carries other people's output. It is
   * classified sensitive, so a personal credential still reads it and the
   * managed one never does.
   */
  "jobs.log": {
    capability: "ci.logs.read",
    path: "/projects/:project/jobs/:jobId/trace",
    security: SENSITIVE_READ,
  },
});

/** Capabilities this deployment allows, in catalog order. */
export function enabledCapabilities(
  flags: GitlabFlags,
): readonly GitlabCapability[] {
  return GITLAB_CAPABILITIES.filter((item) => flags[item.flag]).map(
    (item) => item.capability,
  );
}

/** Label and hint per capability, for clients that render what we declare. */
export const GITLAB_CAPABILITY_INFO: Readonly<
  Record<GitlabCapability, IntegrationCapabilityInfo>
> = Object.freeze(
  Object.fromEntries(
    GITLAB_CAPABILITIES.map((item) => [
      item.capability,
      { label: item.label, hint: item.hint },
    ]),
  ) as Record<GitlabCapability, IntegrationCapabilityInfo>,
);

/** Capability an operation needs, or undefined when the catalog has none. */
export function gitlabOperationCapability(
  operation: string,
): IntegrationCapability | undefined {
  return GITLAB_OPERATIONS[operation]?.capability;
}

/** Security classification of an operation, or undefined when it is unknown. */
export function gitlabOperationMetadata(
  operation: string,
): OperationSecurityMetadata | undefined {
  return GITLAB_OPERATIONS[operation]?.security;
}

/** Capabilities satisfied by the scopes a GitLab token reports. */
export function capabilitiesForScopes(
  scopes: readonly string[],
): readonly GitlabCapability[] {
  const granted = new Set(scopes.map((scope) => scope.trim().toLowerCase()));
  return GITLAB_CAPABILITIES.filter((item) =>
    item.scopes.some((scope) => granted.has(scope)),
  ).map((item) => item.capability);
}

/** Capability id this release split in two; kept for the store migration. */
export const GITLAB_LEGACY_CI_CAPABILITY = "ci.read";
/** The two capabilities that replaced it. */
export const GITLAB_CI_SPLIT_CAPABILITIES: readonly GitlabCapability[] =
  Object.freeze(["ci.metadata.read", "ci.logs.read"]);
