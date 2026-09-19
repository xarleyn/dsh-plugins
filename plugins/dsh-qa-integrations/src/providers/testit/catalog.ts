import type { OperationSecurityMetadata } from "../../service-credentials/types.js";
import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
} from "../../types.js";
import type { TestitFlags } from "./config.js";

/**
 * Capabilities this provider offers, one per kind of Test IT data a user may
 * hand to the agent. They are narrower than Test IT's own permissions on
 * purpose: a token grants areas (test library, test plans, runs), while the
 * agent gets one switch per area, so a user who only needs "what failed in this
 * run" can hand over runs and results without the test library.
 */
export type TestitCapability =
  | "projects.read"
  | "sections.read"
  | "workItems.read"
  | "history.read"
  | "comments.read"
  | "testPlans.read"
  | "testRuns.read"
  | "testResults.read"
  | "autoTests.read"
  | "attachments.read"
  | "configurations.read";

/** Boolean deployment switches of this provider, one per capability. */
export type TestitReadFlag =
  | "projectsRead"
  | "sectionsRead"
  | "workItemsRead"
  | "historyRead"
  | "commentsRead"
  | "testPlansRead"
  | "testRunsRead"
  | "testResultsRead"
  | "autoTestsRead"
  | "attachmentsRead"
  | "configurationsRead";

export interface TestitCapabilityDefinition {
  readonly capability: TestitCapability;
  readonly flag: TestitReadFlag;
  readonly label: string;
  readonly hint: string;
}

export const TESTIT_CAPABILITIES: readonly TestitCapabilityDefinition[] =
  Object.freeze([
    {
      capability: "projects.read",
      flag: "projectsRead",
      label: "Читать проекты",
      hint: "Список проектов Test IT, доступных владельцу токена, и карточка проекта",
    },
    {
      capability: "sections.read",
      flag: "sectionsRead",
      label: "Читать разделы",
      hint: "Разделы (папки) тест-библиотеки проекта",
    },
    {
      capability: "workItems.read",
      flag: "workItemsRead",
      label: "Читать тест-кейсы",
      hint: "Тест-кейсы, чек-листы и общие шаги: список проекта и полная карточка",
    },
    {
      capability: "history.read",
      flag: "historyRead",
      label: "Читать историю изменений",
      hint: "Кто и когда менял тест-кейс: версии, поля, автор изменения",
    },
    {
      capability: "comments.read",
      flag: "commentsRead",
      label: "Читать комментарии",
      hint: "Комментарии к тест-кейсу с авторами и датами",
    },
    {
      capability: "testPlans.read",
      flag: "testPlansRead",
      label: "Читать тест-планы",
      hint: "Тест-планы проекта, карточка плана и сводка по его тест-поинтам",
    },
    {
      capability: "testRuns.read",
      flag: "testRunsRead",
      label: "Читать прогоны",
      hint: "Прогоны проекта по состояниям и датам, карточка прогона",
    },
    {
      capability: "testResults.read",
      flag: "testResultsRead",
      label: "Читать результаты тестов",
      hint: "Результаты прогона, отдельный результат и история результатов тест-кейса",
    },
    {
      capability: "autoTests.read",
      flag: "autoTestsRead",
      label: "Читать автотесты",
      hint: "Автотесты проекта: класс, пространство имён, стабильность, карточка",
    },
    {
      capability: "attachments.read",
      flag: "attachmentsRead",
      label: "Читать вложения",
      hint: "Метаданные вложений и текст небольших текстовых файлов",
    },
    {
      capability: "configurations.read",
      flag: "configurationsRead",
      label: "Читать конфигурации",
      hint: "Конфигурации проекта — то, в разрезе чего считаются результаты",
    },
  ]);

/**
 * What a list operation answers with upstream:
 *
 * - `paged` — the endpoint pages itself: the provider passes `Skip`/`Take` on
 *   and reports `Pagination-*` headers back as `pagination`;
 * - `capped` — the endpoint answers the whole collection at once, so the
 *   provider slices it to the limit and says `truncated` when it had to.
 */
export type TestitListKind = "paged" | "capped";

/** A read of the connection itself: no project, nothing of anybody's work. */
const IDENTITY_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: false,
} as const satisfies OperationSecurityMetadata;

/**
 * A read whose answer belongs to one Test IT project. `requiresResourceBoundary`
 * makes the broker prove the profile bounds projects at all, and the provider
 * holds the call inside the boundary — which is what a service account needs,
 * because it can see every project of the installation, not just the ones this
 * workspace was granted.
 */
const PROJECT_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

/**
 * A read of bytes somebody uploaded. The provider reads only small text files
 * even personally, but the body is still whatever a colleague put there — a log
 * with a password in it, a key, a screenshot — so the managed credential never
 * downloads one.
 */
const SENSITIVE_READ = {
  effect: "read",
  sensitivity: "sensitive",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

/**
 * A read that stays a normal read but is refused to the managed credential all
 * the same: Test IT names no owner on attachment metadata, so a global
 * attachment id cannot be mapped to a project and service mode cannot prove
 * where it lives. Denied, not bounded — fail closed when in doubt.
 */
const UNMAPPABLE_READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
} as const satisfies OperationSecurityMetadata;

export interface TestitOperationDefinition {
  readonly capability: TestitCapability;
  /**
   * API path under `/api/v2`. `:placeholders` are filled by the handler built
   * for that operation; the value is a fixed string, so the model can never
   * pick an endpoint of its own.
   *
   * Where an operation needs a companion call, the provider makes it itself.
   */
  readonly path: string;
  /**
   * Every operation of this catalog is a read. The field exists so the package
   * gate can assert that, instead of trusting the path names to look harmless.
   */
  readonly method: "GET";
  readonly list?: TestitListKind;
  /**
   * True for the one operation whose answer is a byte stream rather than JSON:
   * the provider reads it through its bounded text path instead.
   */
  readonly stream?: boolean;
  /** What this operation does, how sensitive it is, who may reach it. */
  readonly security: OperationSecurityMetadata;
}

/** The resource kind every project-scoped operation of this provider is bounded by. */
export const TESTIT_RESOURCE_KIND = "projects";

/**
 * Every model-reachable operation. The provider refuses any operation that is
 * not listed here, so this table — together with `capability` — is the
 * permission surface.
 *
 * The catalog holds GET endpoints only. Test IT offers richer filtering on
 * `POST /api/v2/.../search` and reports statistics through
 * `POST /api/v2/testRuns/{id}/statistics/filter`, but every search endpoint is a
 * POST, and this package's read-only guarantee is written as "every catalog
 * operation is a GET". The reads below cover the same ground through the GET
 * surface Test IT serves; the tools that the POST-only endpoints would have
 * backed are listed as missing in the README instead of being smuggled in.
 * Three of them (`projects.list`, `workItems.list`, `autoTests.list`) are the
 * endpoints Test IT marks deprecated: they are kept because they are the only
 * GET reads of those collections, and a version that drops them answers
 * `ResourceNotFound`, which the model sees as an honest "not available here".
 *
 * The catalog carries no operation that could change Test IT state — no test-case
 * edits, comments, run lifecycle or attachment uploads; those wait for the
 * confirmation framework the specification requires for them. What a managed
 * credential reaches is decided per operation by `security`.
 */
export const TESTIT_OPERATIONS: Readonly<
  Record<string, TestitOperationDefinition>
> = Object.freeze({
  "connection.get": {
    capability: "projects.read",
    path: "/projects",
    method: "GET",
    security: IDENTITY_READ,
  },
  "projects.list": {
    capability: "projects.read",
    path: "/projects",
    method: "GET",
    list: "paged",
    security: PROJECT_READ,
  },
  "projects.get": {
    capability: "projects.read",
    path: "/projects/{id}",
    method: "GET",
    security: PROJECT_READ,
  },
  "sections.list": {
    capability: "sections.read",
    path: "/projects/{projectId}/sections",
    method: "GET",
    list: "paged",
    security: PROJECT_READ,
  },
  "workItems.list": {
    capability: "workItems.read",
    path: "/projects/{projectId}/workItems",
    method: "GET",
    list: "paged",
    security: PROJECT_READ,
  },
  "workItems.get": {
    capability: "workItems.read",
    path: "/workItems/{id}",
    method: "GET",
    security: PROJECT_READ,
  },
  "workItems.history": {
    capability: "history.read",
    path: "/workItems/{id}/history",
    method: "GET",
    list: "paged",
    security: PROJECT_READ,
  },
  "workItems.comments": {
    capability: "comments.read",
    path: "/workItems/{id}/comments",
    method: "GET",
    list: "capped",
    security: PROJECT_READ,
  },
  "workItems.testResults": {
    capability: "testResults.read",
    path: "/workItems/{id}/testResults/history",
    method: "GET",
    list: "paged",
    security: PROJECT_READ,
  },
  "testPlans.list": {
    capability: "testPlans.read",
    path: "/projects/{projectId}/testPlans",
    method: "GET",
    list: "capped",
    security: PROJECT_READ,
  },
  "testPlans.get": {
    capability: "testPlans.read",
    path: "/testPlans/{id}",
    method: "GET",
    security: PROJECT_READ,
  },
  "testPlans.summary": {
    capability: "testPlans.read",
    path: "/testPlans/{id}/summaries",
    method: "GET",
    list: "capped",
    security: PROJECT_READ,
  },
  "testRuns.list": {
    capability: "testRuns.read",
    path: "/projects/{projectId}/testRuns",
    method: "GET",
    list: "paged",
    security: PROJECT_READ,
  },
  "testRuns.get": {
    capability: "testRuns.read",
    path: "/testRuns/{id}",
    method: "GET",
    security: PROJECT_READ,
  },
  "testRuns.results": {
    capability: "testResults.read",
    path: "/testRuns/{id}/testPoints/results",
    method: "GET",
    list: "capped",
    security: PROJECT_READ,
  },
  "testResults.get": {
    capability: "testResults.read",
    path: "/testResults/{id}",
    method: "GET",
    security: PROJECT_READ,
  },
  "testResults.attachments": {
    capability: "attachments.read",
    path: "/testResults/{id}/attachments",
    method: "GET",
    list: "capped",
    security: PROJECT_READ,
  },
  "attachments.metadata": {
    capability: "attachments.read",
    path: "/attachments/{id}/metadata",
    method: "GET",
    security: UNMAPPABLE_READ,
  },
  "attachments.text": {
    capability: "attachments.read",
    path: "/attachments/{id}",
    method: "GET",
    stream: true,
    security: SENSITIVE_READ,
  },
  "autoTests.list": {
    capability: "autoTests.read",
    path: "/autoTests",
    method: "GET",
    list: "paged",
    security: PROJECT_READ,
  },
  "autoTests.get": {
    capability: "autoTests.read",
    path: "/autoTests/{id}",
    method: "GET",
    security: PROJECT_READ,
  },
  "configurations.list": {
    capability: "configurations.read",
    path: "/projects/{projectId}/configurations",
    method: "GET",
    list: "capped",
    security: PROJECT_READ,
  },
});

/** Capabilities this deployment allows, in catalog order. */
export function enabledCapabilities(
  flags: TestitFlags,
): readonly TestitCapability[] {
  return TESTIT_CAPABILITIES.filter((item) => flags[item.flag]).map(
    (item) => item.capability,
  );
}

/** Label and hint per capability, for clients that render what we declare. */
export const TESTIT_CAPABILITY_INFO: Readonly<
  Record<TestitCapability, IntegrationCapabilityInfo>
> = Object.freeze(
  Object.fromEntries(
    TESTIT_CAPABILITIES.map((item) => [
      item.capability,
      { label: item.label, hint: item.hint },
    ]),
  ) as Record<TestitCapability, IntegrationCapabilityInfo>,
);

/** Capability an operation needs, or undefined when the catalog has none. */
export function testitOperationCapability(
  operation: string,
): IntegrationCapability | undefined {
  return TESTIT_OPERATIONS[operation]?.capability;
}

/** Security classification of an operation, or undefined when it is unknown. */
export function testitOperationMetadata(
  operation: string,
): OperationSecurityMetadata | undefined {
  return TESTIT_OPERATIONS[operation]?.security;
}
