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
 */
export type GitlabCapability =
  | "identity.read"
  | "projects.read"
  | "repository.read"
  | "search.read"
  | "issues.read"
  | "merge_requests.read"
  | "ci.read";

export interface GitlabCapabilityDefinition {
  readonly capability: GitlabCapability;
  readonly flag: Exclude<
    keyof GitlabFlags,
    "instances" | "retries" | "enabled"
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
      capability: "ci.read",
      flag: "ciRead",
      scopes: ["read_api", "api"],
      label: "Читать CI/CD",
      hint: "Пайплайны, джобы пайплайна и лог джоба",
    },
  ]);

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
}

/**
 * Every model-reachable operation. The provider refuses any operation that is
 * not listed here, so this table — together with `capability` — is the
 * permission surface. Only GET: the catalog carries no operation that could
 * change GitLab state, and the confirmation framework does not exist yet.
 */
export const GITLAB_OPERATIONS: Readonly<
  Record<string, GitlabOperationDefinition>
> = Object.freeze({
  "connection.get": { capability: "identity.read", path: "/user" },
  "projects.list": {
    capability: "projects.read",
    path: "/projects",
    list: true,
  },
  "projects.get": { capability: "projects.read", path: "/projects/:project" },
  "repository.tree": {
    capability: "repository.read",
    path: "/projects/:project/repository/tree",
    list: true,
  },
  "repository.file": {
    capability: "repository.read",
    path: "/projects/:project/repository/files/:path",
  },
  "repository.commits": {
    capability: "repository.read",
    path: "/projects/:project/repository/commits",
    list: true,
  },
  "repository.commit": {
    capability: "repository.read",
    // `stats` asks GitLab for the diff line counts of the single commit.
    path: "/projects/:project/repository/commits/:sha",
  },
  "repository.compare": {
    capability: "repository.read",
    path: "/projects/:project/repository/compare",
  },
  "search.run": { capability: "search.read", path: "/search", list: true },
  "issues.list": { capability: "issues.read", path: "/issues", list: true },
  "issues.get": {
    capability: "issues.read",
    path: "/projects/:project/issues/:iid",
  },
  "issues.notes": {
    capability: "issues.read",
    path: "/projects/:project/issues/:iid/notes",
    list: true,
  },
  "mergeRequests.list": {
    capability: "merge_requests.read",
    path: "/merge_requests",
    list: true,
  },
  "mergeRequests.get": {
    capability: "merge_requests.read",
    path: "/projects/:project/merge_requests/:iid",
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
  },
  "mergeRequests.discussions": {
    capability: "merge_requests.read",
    path: "/projects/:project/merge_requests/:iid/discussions",
    list: true,
  },
  "mergeRequests.approvals": {
    capability: "merge_requests.read",
    path: "/projects/:project/merge_requests/:iid/approvals",
  },
  "mergeRequests.pipelines": {
    capability: "merge_requests.read",
    path: "/projects/:project/merge_requests/:iid/pipelines",
    list: true,
  },
  "pipelines.list": {
    capability: "ci.read",
    path: "/projects/:project/pipelines",
    list: true,
  },
  "pipelines.get": {
    capability: "ci.read",
    path: "/projects/:project/pipelines/:pipelineId",
  },
  "pipelines.jobs": {
    capability: "ci.read",
    path: "/projects/:project/pipelines/:pipelineId/jobs",
    list: true,
  },
  "jobs.get": { capability: "ci.read", path: "/projects/:project/jobs/:jobId" },
  "jobs.log": {
    capability: "ci.read",
    path: "/projects/:project/jobs/:jobId/trace",
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

/** Capabilities satisfied by the scopes a GitLab token reports. */
export function capabilitiesForScopes(
  scopes: readonly string[],
): readonly GitlabCapability[] {
  const granted = new Set(scopes.map((scope) => scope.trim().toLowerCase()));
  return GITLAB_CAPABILITIES.filter((item) =>
    item.scopes.some((scope) => granted.has(scope)),
  ).map((item) => item.capability);
}
