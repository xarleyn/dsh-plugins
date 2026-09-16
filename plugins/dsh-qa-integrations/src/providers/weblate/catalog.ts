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
}

/**
 * Every model-reachable operation. The provider refuses any operation that is
 * not listed here, so this table — together with `capability` — is the
 * permission surface. Only GET: localization writes (suggestions, comments,
 * translations, approvals) and the repository, file and autotranslate
 * operations stay out until the confirmation framework exists.
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
  "connection.get": { capability: "identity.read", path: "/users/" },
  "projects.list": {
    capability: "projects.read",
    path: "/projects/",
    list: true,
  },
  "projects.get": { capability: "projects.read", path: "/projects/:project/" },
  "projects.statistics": {
    capability: "statistics.read",
    path: "/projects/:project/statistics/",
  },
  "components.list": {
    capability: "components.read",
    path: "/projects/:project/components/",
    list: true,
  },
  "components.get": {
    capability: "components.read",
    path: "/components/:project/:component/",
  },
  "components.statistics": {
    capability: "statistics.read",
    path: "/components/:project/:component/statistics/",
  },
  "translations.list": {
    capability: "translations.read",
    path: "/components/:project/:component/translations/",
    list: true,
  },
  "translations.get": {
    capability: "translations.read",
    path: "/translations/:project/:component/:language/",
  },
  "translations.statistics": {
    capability: "statistics.read",
    path: "/translations/:project/:component/:language/statistics/",
  },
  /** Units of one translation, filtered by Weblate's own `q` search. */
  "units.search": {
    capability: "units.read",
    path: "/translations/:project/:component/:language/units/",
    list: true,
  },
  /**
   * Units across everything the token can see, which is how one source string is
   * followed into every language it was translated into. Weblate's search
   * grammar carries the project, component and language filters here.
   */
  "units.find": { capability: "units.read", path: "/units/", list: true },
  "units.get": { capability: "units.read", path: "/units/:unitId/" },
  "units.comments": {
    capability: "comments.read",
    path: "/units/:unitId/comments/",
    list: true,
  },
  "units.suggestions": {
    capability: "suggestions.read",
    path: "/units/:unitId/suggestions/",
    list: true,
  },
  /**
   * `has:check` is Weblate's own filter for strings that fail at least one
   * check, so this is the same endpoint as `units.find` with a fixed clause.
   */
  "units.failing": {
    capability: "checks.read",
    path: "/units/",
    list: true,
  },
  /**
   * Weblate exposes change history per project, component and translation, but
   * not per unit; the project scope is the one that needs no extra argument, and
   * every change row carries the unit and translation it belongs to.
   */
  "changes.list": {
    capability: "changes.read",
    path: "/projects/:project/changes/",
    list: true,
  },
  "screenshots.list": {
    capability: "screenshots.read",
    path: "/screenshots/",
    list: true,
  },
  "screenshots.get": {
    capability: "screenshots.read",
    path: "/screenshots/:screenshotId/",
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
