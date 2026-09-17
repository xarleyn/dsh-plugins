import type { OperationSecurityMetadata } from "../../service-credentials/types.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
} from "../../types.js";
import type { TeamCityFlags } from "./config.js";

/**
 * Capabilities this provider offers, one per kind of TeamCity data a user may
 * hand to the agent. They are narrower than TeamCity's own permissions on
 * purpose: a TeamCity token grants whole areas (or is limited per project), while
 * the agent gets one switch per area, so a user who only needs "why did my build
 * fail" can hand over failures and logs without projects or agents.
 *
 * Logs and artifacts live under their own capability because a build log is the
 * classic place an internal address or a secret leaks from: the deployment's
 * managed credential reads build metadata, never the text a build printed.
 */
export type TeamCityCapability =
  | "identity.read"
  | "projects.read"
  | "buildConfigs.read"
  | "builds.read"
  | "failures.read"
  | "logs.read"
  | "queue.read"
  | "investigations.read"
  | "agents.read"
  | "artifacts.read";

/** Boolean deployment switches of this provider, one per capability. */
export type TeamCityReadFlag =
  | "identityRead"
  | "projectsRead"
  | "buildConfigsRead"
  | "buildsRead"
  | "failuresRead"
  | "logsRead"
  | "queueRead"
  | "investigationsRead"
  | "agentsRead"
  | "artifactsRead";

/** Operations whose answer is a window over text rather than JSON. */
export const TEAMCITY_STREAM_OPERATIONS: readonly string[] = Object.freeze([
  "builds.log",
  "artifacts.text",
]);

export interface TeamCityCapabilityDefinition {
  readonly capability: TeamCityCapability;
  readonly flag: TeamCityReadFlag;
  readonly label: string;
  readonly hint: string;
}

export const TEAMCITY_CAPABILITIES: readonly TeamCityCapabilityDefinition[] =
  Object.freeze([
    {
      capability: "identity.read",
      flag: "identityRead",
      label: "Свой сервер и профиль",
      hint: "Адрес TeamCity, версия сервера и подключённый пользователь",
    },
    {
      capability: "projects.read",
      flag: "projectsRead",
      label: "Читать проекты",
      hint: "Список и поиск проектов TeamCity",
    },
    {
      capability: "buildConfigs.read",
      flag: "buildConfigsRead",
      label: "Читать конфигурации сборки",
      hint: "Конфигурации сборки проекта: id, название, пауза",
    },
    {
      capability: "builds.read",
      flag: "buildsRead",
      label: "Читать сборки",
      hint: "Список сборок по фильтрам, карточка сборки и её изменения в VCS",
    },
    {
      capability: "failures.read",
      flag: "failuresRead",
      label: "Читать причины падения",
      hint: "Упавшие тесты и проблемы сборки — ответ на «почему упало»",
    },
    {
      capability: "logs.read",
      flag: "logsRead",
      label: "Читать лог сборки",
      hint: "Ограниченный фрагмент лога сборки: начало, конец или поиск по строкам",
    },
    {
      capability: "queue.read",
      flag: "queueRead",
      label: "Читать очередь сборки",
      hint: "Сборки в очереди: что ждёт исполнителя и на какой ветке",
    },
    {
      capability: "investigations.read",
      flag: "investigationsRead",
      label: "Читать расследования",
      hint: "Активные расследования падений: состояние и ответственный",
    },
    {
      capability: "agents.read",
      flag: "agentsRead",
      label: "Читать агентов",
      hint: "Агенты сборки: подключён, включён, авторизован, чем занят",
    },
    {
      capability: "artifacts.read",
      flag: "artifactsRead",
      label: "Читать артефакты",
      hint: "Список артефактов сборки и текст небольших текстовых файлов",
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
 * A read of ordinary build data. Service mode holds it inside the profile's
 * project boundary: a build addressed by its own id is resolved to the project
 * it belongs to before the answer is fetched, so a direct object read passes the
 * same policy a listing does.
 */
const PROJECT_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

/**
 * A read whose answer is text a build produced. `failures.get` deliberately does
 * not belong here: it answers with normalized failed tests and problems, not
 * with the log, which is why the specification keeps it service-safe.
 */
const SENSITIVE_READ = {
  effect: "read",
  sensitivity: "sensitive",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

export interface TeamCityOperationDefinition {
  readonly capability: TeamCityCapability;
  /**
   * REST path under `/app/rest`, or the one non-REST path TeamCity serves the
   * plain build log from. `:placeholders` are filled by the handler built for
   * that operation; the value is a fixed string, so the model can never pick an
   * endpoint of its own.
   *
   * Where an operation needs a companion endpoint (`/users/current` next to
   * `/server`, `/problemOccurrences` next to `/testOccurrences`) the provider
   * adds that call itself; the catalog keeps the primary path.
   */
  readonly path: string;
  /**
   * Every operation of this catalog is a read. The field exists so the package
   * gate can assert that, instead of trusting the path names to look harmless.
   */
  readonly method: "GET";
  /** What this operation does, how sensitive it is, who may reach it. */
  readonly security: OperationSecurityMetadata;
}

/** The resource kind every project-scoped operation of this provider is bounded by. */
export const TEAMCITY_RESOURCE_KIND = "projects";

/**
 * This provider has one server per deployment, so deployment configuration names
 * it by this instance id when it binds a managed credential to it.
 */
export const TEAMCITY_INSTANCE_ID = "teamcity";

/**
 * Every model-reachable operation. The provider refuses any operation that is
 * not listed here, so this table — together with `capability` and `security` —
 * is the permission surface. The catalog carries no operation that could change
 * TeamCity state: trigger, retry, cancel, comment and tags wait for the
 * confirmation framework the specification requires for them.
 */
export const TEAMCITY_OPERATIONS: Readonly<
  Record<string, TeamCityOperationDefinition>
> = Object.freeze({
  "connection.get": {
    capability: "identity.read",
    path: "/server",
    method: "GET",
    security: IDENTITY_READ,
  },
  "projects.list": {
    capability: "projects.read",
    path: "/projects",
    method: "GET",
    security: PROJECT_READ,
  },
  "buildConfigs.list": {
    capability: "buildConfigs.read",
    path: "/buildTypes",
    method: "GET",
    security: PROJECT_READ,
  },
  "builds.list": {
    capability: "builds.read",
    path: "/builds",
    method: "GET",
    security: PROJECT_READ,
  },
  "builds.get": {
    capability: "builds.read",
    path: "/builds/:buildLocator",
    method: "GET",
    security: PROJECT_READ,
  },
  "builds.changes": {
    capability: "builds.read",
    path: "/changes",
    method: "GET",
    security: PROJECT_READ,
  },
  "failures.get": {
    capability: "failures.read",
    path: "/testOccurrences",
    method: "GET",
    security: PROJECT_READ,
  },
  "builds.log": {
    capability: "logs.read",
    path: "/downloadBuildLog.html",
    method: "GET",
    security: SENSITIVE_READ,
  },
  "queue.list": {
    capability: "queue.read",
    path: "/buildQueue",
    method: "GET",
    security: PROJECT_READ,
  },
  "investigations.list": {
    capability: "investigations.read",
    path: "/investigations",
    method: "GET",
    security: PROJECT_READ,
  },
  "agents.list": {
    capability: "agents.read",
    path: "/agents",
    method: "GET",
    security: IDENTITY_READ,
  },
  "artifacts.list": {
    capability: "artifacts.read",
    path: "/builds/:buildLocator/artifacts/children/:path",
    method: "GET",
    security: PROJECT_READ,
  },
  "artifacts.text": {
    capability: "artifacts.read",
    path: "/builds/:buildLocator/artifacts/content/:path",
    method: "GET",
    security: SENSITIVE_READ,
  },
});

/** Capabilities this deployment allows, in catalog order. */
export function enabledCapabilities(
  flags: TeamCityFlags,
): readonly TeamCityCapability[] {
  return TEAMCITY_CAPABILITIES.filter((item) => flags[item.flag]).map(
    (item) => item.capability,
  );
}

/** Label and hint per capability, for clients that render what we declare. */
export const TEAMCITY_CAPABILITY_INFO: Readonly<
  Record<TeamCityCapability, IntegrationCapabilityInfo>
> = Object.freeze(
  Object.fromEntries(
    TEAMCITY_CAPABILITIES.map((item) => [
      item.capability,
      { label: item.label, hint: item.hint },
    ]),
  ) as Record<TeamCityCapability, IntegrationCapabilityInfo>,
);

/** Capability an operation needs, or undefined when the catalog has none. */
export function teamcityOperationCapability(
  operation: string,
): IntegrationCapability | undefined {
  return TEAMCITY_OPERATIONS[operation]?.capability;
}

/** Security classification of an operation, or undefined when it is unknown. */
export function teamcityOperationMetadata(
  operation: string,
): OperationSecurityMetadata | undefined {
  return TEAMCITY_OPERATIONS[operation]?.security;
}
