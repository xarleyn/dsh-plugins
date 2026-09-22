import type { OperationSecurityMetadata } from "../../service-credentials/types.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
} from "../../types.js";
import type { JiraDeployment, JiraFlags } from "./config.js";

/**
 * Capabilities this provider offers, one per kind of Jira data a user may hand
 * to the agent. They are narrower than what an Atlassian account can read on
 * purpose: an API token carries the whole user's permissions, while the agent
 * gets one switch per area, so "поищи задачи" does not have to hand over fields
 * or attachments too.
 *
 * Jira Cloud reports no granted scopes for an API token the way GitLab's
 * self-inspection endpoint does, and probing with a write the provider has no
 * right to make is not an option, so these switches are bounded by the
 * deployment alone and Jira's own permissions decide upstream.
 */
export type JiraCapability =
  | "identity.read"
  | "issues.read"
  | "comments.read"
  | "attachments.read"
  | "transitions.read"
  | "projects.read"
  | "fields.read";

/** Boolean deployment switches of this provider, one per capability. */
export type JiraReadFlag =
  | "identityRead"
  | "issuesRead"
  | "commentsRead"
  | "attachmentsRead"
  | "transitionsRead"
  | "projectsRead"
  | "fieldsRead";

export interface JiraCapabilityDefinition {
  readonly capability: JiraCapability;
  readonly flag: JiraReadFlag;
  readonly label: string;
  readonly hint: string;
}

export const JIRA_CAPABILITIES: readonly JiraCapabilityDefinition[] =
  Object.freeze([
    {
      capability: "identity.read",
      flag: "identityRead",
      label: "Свой профиль",
      hint: "Подключённый пользователь Jira: имя, аккаунт, сайт и его версия",
    },
    {
      capability: "issues.read",
      flag: "issuesRead",
      label: "Читать задачи",
      hint: "Поиск задач по проектам, статусам, меткам и датам, карточка задачи с описанием",
    },
    {
      capability: "comments.read",
      flag: "commentsRead",
      label: "Читать комментарии",
      hint: "Комментарии задачи в порядке создания или от новых к старым",
    },
    {
      capability: "attachments.read",
      flag: "attachmentsRead",
      label: "Читать вложения",
      hint: "Метаданные вложений задачи: имя, тип, размер, автор; без скачивания файлов",
    },
    {
      capability: "transitions.read",
      flag: "transitionsRead",
      label: "Читать переходы статуса",
      hint: "Доступные переходы задачи и их обязательные поля; сам переход не выполняется",
    },
    {
      capability: "projects.read",
      flag: "projectsRead",
      label: "Читать проекты",
      hint: "Карточка проекта: ключ, название, тип, руководитель",
    },
    {
      capability: "fields.read",
      flag: "fieldsRead",
      label: "Читать схему полей",
      hint: "Поля Jira и кастомные поля: id, имя, тип и JQL-имена",
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
 * A read whose answer belongs to a Jira project. `requiresResourceBoundary`
 * makes the broker prove the profile bounds projects at all, and the provider
 * holds the call inside the boundary — which is what a service account needs,
 * because it can see far more than the user it stands in for.
 */
const PROJECT_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

/**
 * A read that hands over what other users uploaded. It stays a read, so a
 * personal credential reaches it normally; the managed credential never does,
 * because a shared account must not expose one user's files to another.
 */
const SENSITIVE_READ = {
  effect: "read",
  sensitivity: "sensitive",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

/**
 * A read of the site's own structure — the field catalog. It names no issue and
 * no project content, and there is nothing of it a profile could list, so it
 * carries no boundary; the deployment switch for the field catalog stays the
 * whole local control over it.
 */
const SITE_STRUCTURE_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: false,
} as const satisfies OperationSecurityMetadata;

export interface JiraOperationDefinition {
  readonly capability: JiraCapability;
  /**
   * REST path under the site's `/rest/api/3` root. `:placeholders` are filled by
   * the handler built for that operation; the value is a fixed string, so the
   * model can never pick an endpoint of its own.
   */
  readonly path: string;
  /**
   * The path of this operation on a Server / Data Center instance, when the
   * product does not serve the Cloud one. Every other operation is the same
   * path under the instance's own `/rest/api/2` root, which is what
   * {@link jiraOperationPath} resolves.
   */
  readonly serverPath?: string;
  /**
   * Every operation of this catalog is a read. The field exists so the package
   * gate can assert that, instead of trusting the path names to look harmless:
   * Jira serves the same paths writes land on (`/transitions` is a POST).
   */
  readonly method: "GET";
  /** Set when the operation answers with one page of a collection. */
  readonly list?: boolean;
  /** What this operation does, how sensitive it is, who may reach it. */
  readonly security: OperationSecurityMetadata;
}

/**
 * The resource kind every project-scoped operation of this provider is bounded
 * by. The entries of a `projects` boundary are Jira project keys — the form
 * every operation addresses a project by (`projects.get` takes a key, an issue
 * key embeds its project's key). A listed numeric project id is honoured where
 * Jira reports one, in a filtered search; a key is what an operator lists.
 */
export const JIRA_RESOURCE_KIND = "projects";

/**
 * Every model-reachable operation. The provider refuses any operation that is
 * not listed here, so this table — together with `capability` — is the
 * permission surface. The catalog carries no operation that could change Jira
 * state: creating, editing, assigning, commenting and transitioning wait for the
 * two-phase confirmation the specification requires for them, which does not
 * exist yet.
 *
 * `issues.search` reads the enhanced search endpoint Jira Cloud serves today;
 * the legacy `/search` was removed by Atlassian, so a catalog that still named
 * it would answer with an error page instead of issues. A Server / Data Center
 * instance is the other way round: it serves exactly the legacy `/search`, and
 * that is why the operation declares a `serverPath` of its own.
 */
export const JIRA_OPERATIONS: Readonly<
  Record<string, JiraOperationDefinition>
> = Object.freeze({
  "connection.get": {
    capability: "identity.read",
    path: "/rest/api/3/myself",
    method: "GET",
    security: IDENTITY_READ,
  },
  "issues.search": {
    capability: "issues.read",
    path: "/rest/api/3/search/jql",
    serverPath: "/rest/api/2/search",
    method: "GET",
    list: true,
    security: PROJECT_READ,
  },
  "issues.get": {
    capability: "issues.read",
    path: "/rest/api/3/issue/:issueKey",
    method: "GET",
    security: PROJECT_READ,
  },
  "issues.comments": {
    capability: "comments.read",
    path: "/rest/api/3/issue/:issueKey/comment",
    method: "GET",
    list: true,
    security: PROJECT_READ,
  },
  /**
   * Attachment rows carry what other users put on an issue — file names, types,
   * sizes, authors — which is the close-to-content metadata a shared account
   * must not hand around. It is classified sensitive, so a personal credential
   * still reads it and the managed one never does. The content download this
   * metadata points at is not in the catalog at all; when it appears, it is
   * classified at least as sensitive.
   */
  "issues.attachments": {
    capability: "attachments.read",
    path: "/rest/api/3/issue/:issueKey",
    method: "GET",
    security: SENSITIVE_READ,
  },
  /**
   * The transitions read only lists what could be done to one issue and what
   * fields each move would need; the move itself has no operation here, so the
   * read stays project-scoped and service-safe.
   */
  "issues.transitions": {
    capability: "transitions.read",
    path: "/rest/api/3/issue/:issueKey/transitions",
    method: "GET",
    security: PROJECT_READ,
  },
  "projects.get": {
    capability: "projects.read",
    path: "/rest/api/3/project/:projectKey",
    method: "GET",
    security: PROJECT_READ,
  },
  "fields.list": {
    capability: "fields.read",
    path: "/rest/api/3/field",
    method: "GET",
    list: true,
    security: SITE_STRUCTURE_READ,
  },
});

/**
 * Reads the provider performs next to a catalog operation, never as one
 * themselves: the deployment type behind a connect and the people directory
 * behind a name filter. They are declared here so the same allow-list governs
 * every request this provider makes.
 */
export const JIRA_COMPANION_PATHS: readonly string[] = Object.freeze([
  "/rest/api/3/serverInfo",
  "/rest/api/3/user/search",
]);

/**
 * The read-only endpoint allow-list of this provider, as path templates. Nothing
 * outside it is reachable: a new operation has to be declared here on purpose,
 * in the same change as the catalog entry that uses it.
 */
export const JIRA_READ_PATHS: readonly string[] = Object.freeze([
  "/rest/api/3/myself",
  "/rest/api/3/search/jql",
  "/rest/api/3/issue/:issueKey",
  "/rest/api/3/issue/:issueKey/comment",
  "/rest/api/3/issue/:issueKey/transitions",
  "/rest/api/3/project/:projectKey",
  "/rest/api/3/field",
  ...JIRA_COMPANION_PATHS,
]);

/**
 * The same allow-list for a Server / Data Center instance, which serves the
 * whole read surface under `/rest/api/2`. It is written out instead of being
 * derived, so that every endpoint this provider may ever call on either product
 * is a line somebody added on purpose — and the package gate asserts the two
 * lists stay in step, entry for entry, apart from the search endpoint that the
 * two products genuinely do not share.
 */
export const JIRA_SERVER_READ_PATHS: readonly string[] = Object.freeze([
  "/rest/api/2/myself",
  "/rest/api/2/search",
  "/rest/api/2/issue/:issueKey",
  "/rest/api/2/issue/:issueKey/comment",
  "/rest/api/2/issue/:issueKey/transitions",
  "/rest/api/2/project/:projectKey",
  "/rest/api/2/field",
  "/rest/api/2/serverInfo",
  "/rest/api/2/user/search",
]);

/**
 * The path of one catalog operation on the site's own product: the declared
 * Cloud path, or its Server / Data Center counterpart — the operation's own
 * when the product serves a different endpoint, and the same path under the
 * instance's `/rest/api/2` root otherwise.
 */
export function jiraOperationPath(
  operation: string,
  deployment: JiraDeployment,
): string | undefined {
  const definition = JIRA_OPERATIONS[operation];
  if (definition === undefined) return undefined;
  if (deployment === "server") {
    return definition.serverPath ?? mirrorToServer(definition.path);
  }
  return definition.path;
}

/** `/rest/api/3/x` as a Data Center instance spells it. */
export function mirrorToServer(path: string): string {
  return `/rest/api/2${path.slice("/rest/api/3".length)}`;
}

/** The two reads this provider makes that are not operations of the catalog. */
export type JiraCompanionRead = "serverInfo" | "userSearch";

/**
 * The path of one companion read on the site's product: the deployment probe a
 * connect makes, and the directory lookup behind a person named by name.
 */
export function jiraCompanionPath(
  read: JiraCompanionRead,
  deployment: JiraDeployment,
): string {
  const cloud =
    read === "serverInfo"
      ? "/rest/api/3/serverInfo"
      : "/rest/api/3/user/search";
  return deployment === "server" ? mirrorToServer(cloud) : cloud;
}

/** Capabilities this deployment allows, in catalog order. */
export function enabledCapabilities(
  flags: JiraFlags,
): readonly JiraCapability[] {
  return JIRA_CAPABILITIES.filter((item) => flags[item.flag]).map(
    (item) => item.capability,
  );
}

/** Label and hint per capability, for clients that render what we declare. */
export const JIRA_CAPABILITY_INFO: Readonly<
  Record<JiraCapability, IntegrationCapabilityInfo>
> = Object.freeze(
  Object.fromEntries(
    JIRA_CAPABILITIES.map((item) => [
      item.capability,
      { label: item.label, hint: item.hint },
    ]),
  ) as Record<JiraCapability, IntegrationCapabilityInfo>,
);

/** Capability an operation needs, or undefined when the catalog has none. */
export function jiraOperationCapability(
  operation: string,
): IntegrationCapability | undefined {
  return JIRA_OPERATIONS[operation]?.capability;
}

/** Security classification of an operation, or undefined when it is unknown. */
export function jiraOperationMetadata(
  operation: string,
): OperationSecurityMetadata | undefined {
  return JIRA_OPERATIONS[operation]?.security;
}
