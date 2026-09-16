import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
} from "../../types.js";
import type { JiraFlags } from "./config.js";

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

export interface JiraOperationDefinition {
  readonly capability: JiraCapability;
  /**
   * REST path under the site's `/rest/api/3` root. `:placeholders` are filled by
   * the handler built for that operation; the value is a fixed string, so the
   * model can never pick an endpoint of its own.
   */
  readonly path: string;
  /**
   * Every operation of this catalog is a read. The field exists so the package
   * gate can assert that, instead of trusting the path names to look harmless:
   * Jira serves the same paths writes land on (`/transitions` is a POST).
   */
  readonly method: "GET";
  /** Set when the operation answers with one page of a collection. */
  readonly list?: boolean;
}

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
 * it would answer with an error page instead of issues.
 */
export const JIRA_OPERATIONS: Readonly<
  Record<string, JiraOperationDefinition>
> = Object.freeze({
  "connection.get": {
    capability: "identity.read",
    path: "/rest/api/3/myself",
    method: "GET",
  },
  "issues.search": {
    capability: "issues.read",
    path: "/rest/api/3/search/jql",
    method: "GET",
    list: true,
  },
  "issues.get": {
    capability: "issues.read",
    path: "/rest/api/3/issue/:issueKey",
    method: "GET",
  },
  "issues.comments": {
    capability: "comments.read",
    path: "/rest/api/3/issue/:issueKey/comment",
    method: "GET",
    list: true,
  },
  /**
   * Attachment metadata lives on the issue itself; Jira serves no listing
   * endpoint for it, so this operation reads the issue with the one field asked
   * for and never downloads a file.
   */
  "issues.attachments": {
    capability: "attachments.read",
    path: "/rest/api/3/issue/:issueKey",
    method: "GET",
  },
  "issues.transitions": {
    capability: "transitions.read",
    path: "/rest/api/3/issue/:issueKey/transitions",
    method: "GET",
  },
  "projects.get": {
    capability: "projects.read",
    path: "/rest/api/3/project/:projectKey",
    method: "GET",
  },
  "fields.list": {
    capability: "fields.read",
    path: "/rest/api/3/field",
    method: "GET",
    list: true,
  },
});

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
]);

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
