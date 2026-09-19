import type { OperationSecurityMetadata } from "../../service-credentials/types.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
} from "../../types.js";
import type { WeblateFlags } from "./config.js";

/**
 * Capabilities this provider offers, one per kind of data rather than one per
 * endpoint: the operator decides what this deployment is willing to expose, and
 * Weblate's own project, component and language permissions still decide what
 * the connected token may read. There is no capability for a write, because the
 * catalog carries no operation that could change Weblate state.
 */
export type WeblateCapability =
  | "identity.read"
  | "projects.read"
  | "components.read"
  | "translations.read"
  | "units.read"
  | "checks.read"
  | "comments.read"
  | "suggestions.read"
  | "changes.read"
  | "statistics.read"
  | "screenshots.read";

export interface WeblateCapabilityDefinition {
  readonly capability: WeblateCapability;
  readonly flag: Exclude<
    keyof WeblateFlags,
    "instances" | "retries" | "enabled" | "allowInsecureHttp"
  >;
  readonly label: string;
  readonly hint: string;
}

export const WEBLATE_CAPABILITIES: readonly WeblateCapabilityDefinition[] =
  Object.freeze([
    {
      capability: "identity.read",
      flag: "identityRead",
      label: "Своё подключение",
      hint: "Пользователь Weblate, от имени которого работает токен, и адрес инстанса",
    },
    {
      capability: "projects.read",
      flag: "projectsRead",
      label: "Читать проекты",
      hint: "Список проектов, карточка проекта: слаг, имя, сайт, языки",
    },
    {
      capability: "components.read",
      flag: "componentsRead",
      label: "Читать компоненты",
      hint: "Компоненты проекта: слаг, имя, формат файлов, репозиторий, языки",
    },
    {
      capability: "translations.read",
      flag: "translationsRead",
      label: "Читать переводы",
      hint: "Переводы компонента по языкам: готовность, автор последней правки, ссылки",
    },
    {
      capability: "units.read",
      flag: "unitsRead",
      label: "Читать строки",
      hint: "Поиск строк по исходному и переведённому тексту, контексту и статусу, чтение одной строки",
    },
    {
      capability: "checks.read",
      flag: "checksRead",
      label: "Читать строки с ошибками проверок",
      hint: "Строки, у которых не проходят проверки Weblate: орфография, разметка, расхождения",
    },
    {
      capability: "comments.read",
      flag: "commentsRead",
      label: "Читать комментарии",
      hint: "Комментарии к строке: автор, время, текст",
    },
    {
      capability: "suggestions.read",
      flag: "suggestionsRead",
      label: "Читать предложения перевода",
      hint: "Предложенные варианты перевода строки: автор, голоса, время",
    },
    {
      capability: "changes.read",
      flag: "changesRead",
      label: "Читать историю изменений",
      hint: "Что и когда менялось в проекте: действие, строка, автор, старое и новое значение",
    },
    {
      capability: "statistics.read",
      flag: "statisticsRead",
      label: "Читать статистику",
      hint: "Готовность перевода по проекту, компоненту и языку: переведено, требует правки, слова",
    },
    {
      capability: "screenshots.read",
      flag: "screenshotsRead",
      label: "Читать скриншоты",
      hint: "Метаданные скриншотов: имя, файл в репозитории, связанные строки. Сами изображения провайдер не скачивает",
    },
  ]);

export interface WeblateOperationDefinition {
  readonly capability: WeblateCapability;
  /**
   * REST path under the instance's `/api` root. `:placeholders` are filled by
   * the handler; the value is a fixed string, so the model can never pick an
   * endpoint of its own.
   */
  readonly path: string;
  /** Set when the operation answers with one page of a collection. */
  readonly list?: boolean;
  /** What this operation does, how sensitive it is, who may reach it. */
  readonly security: OperationSecurityMetadata;
}

/** A read of the connected identity alone: no project, nothing personal. */
const IDENTITY_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: false,
} as const satisfies OperationSecurityMetadata;

/**
 * A read whose answer belongs to a Weblate project. `requiresResourceBoundary`
 * makes the broker prove the profile bounds projects at all, and the provider
 * holds the call inside the boundary — which a component or a unit needs too,
 * because a component belongs to a project and a string lives in one.
 */
const PROJECT_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

/**
 * The resource kind every project-scoped operation of this provider is bounded
 * by. A boundary entry is a project slug exactly as the operations address one,
 * so a boundary entry and a tool argument are compared as strings.
 */
export const WEBLATE_RESOURCE_KIND = "projects";

/**
 * Every model-reachable operation. The provider refuses any operation that is
 * not listed here, so this table — together with `capability` and `security` —
 * is the permission surface. Only GET: localization writes (suggestions, comments,
 * translations, approvals) and the repository, file and autotranslate
 * operations stay out until the confirmation framework exists.
 *
 * No operation of this catalog carries a secret or another person's raw output —
 * there is no repository status or commit text here, and the localization text
 * every read returns is bounded by the deployment's character cap and marked as
 * untrusted content — so none of them is classified sensitive; a shared
 * read-only account answers every one of them inside a project boundary.
 */
export const WEBLATE_OPERATIONS: Readonly<
  Record<string, WeblateOperationDefinition>
> = Object.freeze({
  /**
   * Weblate has no "current user" endpoint. `GET /api/users/` answers with the
   * caller's own record for a token that may not administer users, which is the
   * token shape this provider recommends; the projection reports an unknown
   * account instead of guessing when the answer is a full user list.
   */
  "connection.get": {
    capability: "identity.read",
    path: "/users/",
    security: IDENTITY_READ,
  },
  /**
   * The one listing service mode does not send upstream as-is: the answer is
   * built from the boundary's project list instead of from everything the
   * shared account can see.
   */
  "projects.list": {
    capability: "projects.read",
    path: "/projects/",
    list: true,
    security: PROJECT_READ,
  },
  "projects.get": {
    capability: "projects.read",
    path: "/projects/:project/",
    security: PROJECT_READ,
  },
  "projects.statistics": {
    capability: "statistics.read",
    path: "/projects/:project/statistics/",
    security: PROJECT_READ,
  },
  "components.list": {
    capability: "components.read",
    path: "/projects/:project/components/",
    list: true,
    security: PROJECT_READ,
  },
  "components.get": {
    capability: "components.read",
    path: "/components/:project/:component/",
    security: PROJECT_READ,
  },
  "components.statistics": {
    capability: "statistics.read",
    path: "/components/:project/:component/statistics/",
    security: PROJECT_READ,
  },
  "translations.list": {
    capability: "translations.read",
    path: "/components/:project/:component/translations/",
    list: true,
    security: PROJECT_READ,
  },
  "translations.get": {
    capability: "translations.read",
    path: "/translations/:project/:component/:language/",
    security: PROJECT_READ,
  },
  "translations.statistics": {
    capability: "statistics.read",
    path: "/translations/:project/:component/:language/statistics/",
    security: PROJECT_READ,
  },
  /** Units of one translation, filtered by Weblate's own `q` search. */
  "units.search": {
    capability: "units.read",
    path: "/translations/:project/:component/:language/units/",
    list: true,
    security: PROJECT_READ,
  },
  /**
   * Units across everything the token can see, which is how one source string is
   * followed into every language it was translated into. Weblate's search
   * grammar carries the project, component and language filters here, and
   * service mode turns the project filter from optional into required — an
   * unscoped search would answer with the shared account's whole view.
   */
  "units.find": {
    capability: "units.read",
    path: "/units/",
    list: true,
    security: PROJECT_READ,
  },
  /**
   * Addressed by a unit id alone, so the project it belongs to is read out of
   * the unit's own translation URL upstream and checked before the answer is
   * released.
   */
  "units.get": {
    capability: "units.read",
    path: "/units/:unitId/",
    security: PROJECT_READ,
  },
  "units.comments": {
    capability: "comments.read",
    path: "/units/:unitId/comments/",
    list: true,
    security: PROJECT_READ,
  },
  "units.suggestions": {
    capability: "suggestions.read",
    path: "/units/:unitId/suggestions/",
    list: true,
    security: PROJECT_READ,
  },
  /**
   * `has:check` is Weblate's own filter for strings that fail at least one
   * check, so this is the same endpoint as `units.find` with a fixed clause —
   * and the same service-mode rule: no search without a bounded project.
   */
  "units.failing": {
    capability: "checks.read",
    path: "/units/",
    list: true,
    security: PROJECT_READ,
  },
  /**
   * Weblate exposes change history per project, component and translation, but
   * not per unit; the project scope is the one that needs no extra argument, and
   * every change row carries the unit and translation it belongs to. This is
   * Weblate's own change log, not a version-control one: rows answer with the
   * bounded localization text the rest of this catalog already reads, never
   * with raw repository output, which is why a shared account may read it
   * inside the boundary.
   */
  "changes.list": {
    capability: "changes.read",
    path: "/projects/:project/changes/",
    list: true,
    security: PROJECT_READ,
  },
  /**
   * The endpoint takes no project argument, so service mode holds the page to
   * the boundary after the read: a screenshot whose project cannot be resolved
   * is dropped rather than shown. Only metadata is read; the image itself never
   * is.
   */
  "screenshots.list": {
    capability: "screenshots.read",
    path: "/screenshots/",
    list: true,
    security: PROJECT_READ,
  },
  /**
   * Addressed by a screenshot id alone, resolved to its project the same way a
   * unit is.
   */
  "screenshots.get": {
    capability: "screenshots.read",
    path: "/screenshots/:screenshotId/",
    security: PROJECT_READ,
  },
});

/** Capabilities this deployment allows, in catalog order. */
export function enabledCapabilities(
  flags: WeblateFlags,
): readonly WeblateCapability[] {
  return WEBLATE_CAPABILITIES.filter((item) => flags[item.flag]).map(
    (item) => item.capability,
  );
}

/** Label and hint per capability, for clients that render what we declare. */
export const WEBLATE_CAPABILITY_INFO: Readonly<
  Record<WeblateCapability, IntegrationCapabilityInfo>
> = Object.freeze(
  Object.fromEntries(
    WEBLATE_CAPABILITIES.map((item) => [
      item.capability,
      { label: item.label, hint: item.hint },
    ]),
  ) as Record<WeblateCapability, IntegrationCapabilityInfo>,
);

/** Capability an operation needs, or undefined when the catalog has none. */
export function weblateOperationCapability(
  operation: string,
): IntegrationCapability | undefined {
  return WEBLATE_OPERATIONS[operation]?.capability;
}

/** Security classification of an operation, or undefined when it is unknown. */
export function weblateOperationMetadata(
  operation: string,
): OperationSecurityMetadata | undefined {
  return WEBLATE_OPERATIONS[operation]?.security;
}
