import {
  optionalInteger,
  requiredInteger,
  requiredText,
} from "../../coerce.js";
import { IntegrationError } from "../../errors.js";
import { accountName } from "../shared/account.js";
import type { WeblateFlags } from "./config.js";
import {
  COMMENT_CLAUSE,
  FAILING_CHECK_CLAUSE,
  SUGGESTION_CLAUSE,
  buildUnitQuery,
  exactClause,
  isUnitStateFilter,
  stateClause,
  textClause,
  type UnitStateFilter,
} from "./query.js";
import { resultsOf, type WeblateQuery } from "./transport.js";

/**
 * Weblate project and component slugs are the same character set upstream
 * (`[-a-zA-Z0-9_]+`); components nested in categories put the category path in
 * front of the slug, one path segment per level.
 */
const SLUG = /^[-A-Za-z0-9_]+$/u;
/** Language codes, including the `pt_BR` and `sr@latin` style aliases. */
const LANGUAGE_CODE = /^[A-Za-z0-9][A-Za-z0-9@._+-]{0,49}$/u;

/** Rows per page when the agent does not ask for more. */
export const DEFAULT_PAGE_SIZE = 20;
/** Characters of one source/target string in a list answer. */
export const SUMMARY_TEXT_CHARS = 200;
/** Unit URLs attached to a screenshot; enough to identify, bounded anyway. */
const SCREENSHOT_UNIT_LIMIT = 50;

function invalid(field: string): never {
  throw new IntegrationError("InvalidRequest", `${field} is invalid`);
}

function hasTraversal(value: string): boolean {
  return value
    .split("/")
    .some((segment) => segment === ".." || segment === ".");
}

/** A slug, URL-encoded as one path segment. */
function slug(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 1, 100);
  if (!SLUG.test(normalized)) invalid(field);
  return encodeURIComponent(normalized);
}

/**
 * A component reference: one slug, or a category path in front of it. Every
 * segment is validated and encoded on its own, so the separator that joins them
 * is the provider's and never a character the caller smuggled in.
 */
export function componentRef(value: unknown, field = "component"): string {
  const normalized = requiredText(value, field, 1, 255).replace(
    /^\/+|\/+$/gu,
    "",
  );
  if (normalized === "" || hasTraversal(normalized)) invalid(field);
  const segments = normalized.split("/");
  if (segments.length > 8) invalid(field);
  const encoded: string[] = [];
  for (const segment of segments) {
    if (!SLUG.test(segment)) invalid(field);
    encoded.push(encodeURIComponent(segment));
  }
  return encoded.join("/");
}

export function projectRef(value: unknown, field = "project"): string {
  return slug(value, field);
}

export function languageRef(value: unknown, field = "language"): string {
  const normalized = requiredText(value, field, 1, 50);
  if (!LANGUAGE_CODE.test(normalized)) invalid(field);
  return encodeURIComponent(normalized);
}

/**
 * One page of a collection, plus the cursor the model has to send back. An
 * oversized page is clamped rather than refused: "give me more rows" is a
 * request this deployment answers with its own ceiling, not an error the agent
 * has to learn by trial.
 */
function pagination(
  input: Readonly<Record<string, unknown>>,
  flags: WeblateFlags,
): {
  readonly page: number;
  readonly perPage: number;
  readonly query: WeblateQuery;
} {
  const asked = optionalInteger(input["perPage"], "perPage", 1, 10_000);
  const perPage = Math.min(asked ?? DEFAULT_PAGE_SIZE, flags.maxPageSize);
  const page = optionalInteger(input["page"], "page", 1) ?? 1;
  return { page, perPage, query: { page, page_size: perPage } };
}

/**
 * The `q` clauses the agent's filters translate into. Only documented lookups of
 * Weblate's own search grammar are used; the query string itself is never
 * accepted from the model.
 */
function unitQuery(
  input: Readonly<Record<string, unknown>>,
  extra: readonly string[] = [],
): string {
  const state = input["state"];
  if (state !== undefined && !isUnitStateFilter(state)) invalid("state");
  const text = (field: "source" | "target" | "context"): readonly string[] =>
    input[field] === undefined
      ? []
      : [textClause(field, requiredText(input[field], field, 1, 200))];
  return buildUnitQuery([
    ...text("source"),
    ...text("target"),
    ...text("context"),
    ...(state === undefined ? [] : [stateClause(state as UnitStateFilter)]),
    ...(input["failingChecks"] === true ? [FAILING_CHECK_CLAUSE] : []),
    ...(input["suggestions"] === true ? [SUGGESTION_CLAUSE] : []),
    ...(input["comments"] === true ? [COMMENT_CLAUSE] : []),
    ...extra,
  ]);
}

/** Numeric id of a model-named resource; Weblate ids are positive integers. */
function identifier(value: unknown, field: string): number {
  return requiredInteger(value, field);
}

export interface OperationContext {
  readonly flags: WeblateFlags;
  /** Canonical address of the instance this call is dialled at. */
  readonly origin: string;
}

export interface WeblateRequest {
  readonly path: string;
  readonly query: WeblateQuery;
  /** Present for the operations that answer with one page of a collection. */
  readonly page?: { readonly page: number; readonly perPage: number };
}

export type WeblateOperationHandler = (
  input: Readonly<Record<string, unknown>>,
  context: OperationContext,
) => WeblateRequest;

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (path, [key, value]) => path.replace(`:${key}`, value),
    template,
  );
}

export const WEBLATE_HANDLERS: Readonly<
  Record<string, WeblateOperationHandler>
> = Object.freeze({
  "connection.get": () => ({
    path: "/users/",
    // Two rows are enough to tell "only me" from "the token may list users",
    // which is the whole question this operation answers.
    query: { page_size: 2 },
  }),

  "projects.list": (input, context) => {
    const { page, perPage, query } = pagination(input, context.flags);
    return { path: "/projects/", query, page: { page, perPage } };
  },

  "projects.get": (input) => ({
    path: fill("/projects/:project/", {
      project: projectRef(input["project"]),
    }),
    query: {},
  }),

  "projects.statistics": (input) => ({
    path: fill("/projects/:project/statistics/", {
      project: projectRef(input["project"]),
    }),
    query: {},
  }),

  "components.list": (input, context) => {
    const { page, perPage, query } = pagination(input, context.flags);
    return {
      path: fill("/projects/:project/components/", {
        project: projectRef(input["project"]),
      }),
      query,
      page: { page, perPage },
    };
  },

  "components.get": (input) => ({
    path: fill("/components/:project/:component/", {
      project: projectRef(input["project"]),
      component: componentRef(input["component"]),
    }),
    query: {},
  }),

  "components.statistics": (input) => ({
    path: fill("/components/:project/:component/statistics/", {
      project: projectRef(input["project"]),
      component: componentRef(input["component"]),
    }),
    query: {},
  }),

  "translations.list": (input, context) => {
    const { page, perPage, query } = pagination(input, context.flags);
    return {
      path: fill("/components/:project/:component/translations/", {
        project: projectRef(input["project"]),
        component: componentRef(input["component"]),
      }),
      query,
      page: { page, perPage },
    };
  },

  "translations.get": (input) => ({
    path: fill("/translations/:project/:component/:language/", {
      project: projectRef(input["project"]),
      component: componentRef(input["component"]),
      language: languageRef(input["language"]),
    }),
    query: {},
  }),

  "translations.statistics": (input) => ({
    path: fill("/translations/:project/:component/:language/statistics/", {
      project: projectRef(input["project"]),
      component: componentRef(input["component"]),
      language: languageRef(input["language"]),
    }),
    query: {},
  }),

  "units.search": (input, context) => {
    const { page, perPage, query } = pagination(input, context.flags);
    const search = unitQuery(input);
    return {
      path: fill("/translations/:project/:component/:language/units/", {
        project: projectRef(input["project"]),
        component: componentRef(input["component"]),
        language: languageRef(input["language"]),
      }),
      query: search === "" ? query : { ...query, q: search },
      page: { page, perPage },
    };
  },

  "units.find": (input, context) => {
    const { page, perPage, query } = pagination(input, context.flags);
    const search = unitQuery(input, [
      ...(input["project"] === undefined
        ? []
        : [exactClause("project", projectRef(input["project"]))]),
      ...(input["component"] === undefined
        ? []
        : [exactClause("component", componentRef(input["component"]))]),
      ...(input["language"] === undefined
        ? []
        : [exactClause("language", languageRef(input["language"]))]),
    ]);
    return {
      path: "/units/",
      query: search === "" ? query : { ...query, q: search },
      page: { page, perPage },
    };
  },

  "units.failing": (input, context) => {
    const { page, perPage, query } = pagination(input, context.flags);
    const search = unitQuery(input, [
      FAILING_CHECK_CLAUSE,
      ...(input["project"] === undefined
        ? []
        : [exactClause("project", projectRef(input["project"]))]),
      ...(input["component"] === undefined
        ? []
        : [exactClause("component", componentRef(input["component"]))]),
      ...(input["language"] === undefined
        ? []
        : [exactClause("language", languageRef(input["language"]))]),
    ]);
    return {
      path: "/units/",
      // A set never repeats a clause, and the projection reports the check flag
      // on every row so the agent can see which string failed.
      query: { ...query, q: search },
      page: { page, perPage },
    };
  },

  "units.get": (input) => ({
    path: fill("/units/:unitId/", {
      unitId: String(identifier(input["unitId"], "unitId")),
    }),
    query: {},
  }),

  "units.comments": (input, context) => {
    const { page, perPage, query } = pagination(input, context.flags);
    return {
      path: fill("/units/:unitId/comments/", {
        unitId: String(identifier(input["unitId"], "unitId")),
      }),
      query,
      page: { page, perPage },
    };
  },

  "units.suggestions": (input, context) => {
    const { page, perPage, query } = pagination(input, context.flags);
    return {
      path: fill("/units/:unitId/suggestions/", {
        unitId: String(identifier(input["unitId"], "unitId")),
      }),
      query,
      page: { page, perPage },
    };
  },

  "changes.list": (input, context) => {
    const { page, perPage, query } = pagination(input, context.flags);
    return {
      path: fill("/projects/:project/changes/", {
        project: projectRef(input["project"]),
      }),
      query,
      page: { page, perPage },
    };
  },

  "screenshots.list": (input, context) => {
    const { page, perPage, query } = pagination(input, context.flags);
    return { path: "/screenshots/", query, page: { page, perPage } };
  },

  "screenshots.get": (input) => ({
    path: fill("/screenshots/:screenshotId/", {
      screenshotId: String(identifier(input["screenshotId"], "screenshotId")),
    }),
    query: {},
  }),
});

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOf(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function numberOf(
  source: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanOf(
  source: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

/** Drop unset keys so a projection never answers with `undefined` holes. */
function compact(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  );
}

/** Cut a string at a character budget without leaving half a surrogate pair. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * A plural string as Weblate reports it: one string or one per plural form. The
 * answer keeps the shape and says whether anything was cut, because a
 * translation silently shorter than the real one would be read as the truth.
 */
function boundedStrings(
  value: unknown,
  limit: number,
): { readonly items: string[]; readonly truncated: boolean } {
  const items =
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
  const truncated = items.some((item) => item.length > limit);
  return { items: items.map((item) => clip(item, limit)), truncated };
}

/**
 * Labels as Weblate reports them: unit labels carry their project and a colour
 * next to the name, and only the name is a localization attribute.
 */
function labelNamesOf(
  source: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      names.push(item);
      continue;
    }
    const name = recordOf(item)["name"];
    if (typeof name === "string" && name !== "") names.push(name);
  }
  return names;
}

/**
 * Upstream URLs are echoed only when they point at the configured instance, and
 * never followed: the provider answers with the address, it does not dial it.
 */
export function sameOriginUrl(
  value: unknown,
  origin: string,
): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try {
    const url = new URL(value);
    return url.origin === origin ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Path segments of a same-origin API URL below `/api/<marker>/`. */
function apiSegments(
  value: unknown,
  origin: string,
  marker: string,
): readonly string[] | undefined {
  const url = sameOriginUrl(value, origin);
  if (url === undefined) return undefined;
  const segments = new URL(url).pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  const markerAt = segments.indexOf(marker);
  if (markerAt === -1) return undefined;
  const tail = segments.slice(markerAt + 1);
  return tail.length === 0 ? undefined : tail;
}

/**
 * Which project, component and language a unit belongs to, read out of the
 * translation URL Weblate itself put in the answer. A category path keeps its
 * place, so a component inside a category is reported and re-usable as the
 * `component` argument of another call.
 */
export function translationRef(
  value: unknown,
  origin: string,
): Record<string, unknown> | undefined {
  const tail = apiSegments(value, origin, "translations");
  if (tail === undefined || tail.length < 3) return undefined;
  return {
    project: tail[0],
    component: tail.slice(1, -1).join("/"),
    language: tail[tail.length - 1],
  };
}

/** The numeric id inside a same-origin `/api/units/<id>/` URL. */
function unitIdOf(value: unknown, origin: string): number | undefined {
  const tail = apiSegments(value, origin, "units");
  if (tail === undefined || tail.length !== 1) return undefined;
  const id = Number(tail[0]);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** The username inside a same-origin `/api/users/<username>/` URL. */
function usernameOf(value: unknown, origin: string): string | undefined {
  const tail = apiSegments(value, origin, "users");
  if (tail === undefined || tail.length !== 1) return undefined;
  return tail[0];
}

/** Weblate's numeric unit states, as the API documents them. */
const UNIT_STATES: Readonly<Record<number, string>> = Object.freeze({
  0: "untranslated",
  10: "needs-editing",
  20: "translated",
  30: "approved",
  100: "read-only",
});

export function unitState(value: unknown): string {
  return typeof value === "number"
    ? (UNIT_STATES[value] ?? "unknown")
    : "unknown";
}

/**
 * The Weblate account a `GET /api/users/` answer belongs to. An unprivileged
 * token sees only itself, which is how the connected account is identified; a
 * token that may list users answers with many rows, and then the account is
 * reported as unknown rather than guessed from the first row.
 */
export function accountFromUsers(data: unknown): {
  readonly account: Record<string, unknown> | null;
  readonly resolved: boolean;
} {
  const users = resultsOf(data);
  if (users.length !== 1) return { account: null, resolved: false };
  const source = recordOf(users[0]);
  const id = numberOf(source, "id");
  return {
    account: compact({
      id,
      username: stringOf(source, "username"),
      name: stringOf(source, "name"),
      isBot: booleanOf(source, "is_bot"),
    }),
    resolved: true,
  };
}

/**
 * The name of the account as the Settings card shows it. An unresolved account
 * falls back to whatever the caller names instead of a name picked at random.
 */
export function accountNameFrom(data: unknown, fallback: string): string {
  const { account } = accountFromUsers(data);
  return account === null ? fallback : accountName(account, fallback);
}

/** External id the broker stores for this connection, when it is known. */
export function accountIdFrom(data: unknown): string {
  const { account } = accountFromUsers(data);
  const id = account?.["id"];
  return typeof id === "number" ? String(id) : "";
}

export interface WeblateProjectionContext {
  readonly flags: WeblateFlags;
  readonly origin: string;
  /** Character budget for one string in this answer. */
  readonly textLimit: number;
}

export type WeblateProjection = (
  data: unknown,
  context: WeblateProjectionContext,
) => unknown;

function projectSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: numberOf(source, "id"),
    name: stringOf(source, "name"),
    slug: stringOf(source, "slug"),
    webUrl: stringOf(source, "web_url"),
  });
}

function languageSummary(value: unknown): Record<string, unknown> | undefined {
  const source = recordOf(value);
  const code = stringOf(source, "code");
  if (code === undefined) return undefined;
  return compact({
    code,
    name: stringOf(source, "name"),
    pluralForms: numberOf(source, "plural_forms"),
  });
}

function componentSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: numberOf(source, "id"),
    name: stringOf(source, "name"),
    slug: stringOf(source, "slug"),
    vcs: stringOf(source, "vcs"),
    branch: stringOf(source, "branch"),
    fileFormat: stringOf(source, "file_format"),
    sourceLanguage: languageSummary(source["source_language"]),
    webUrl: stringOf(source, "web_url"),
  });
}

function translationSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    // The nested listing removes the component, the single read keeps it.
    component: componentSummary(source["component"]),
    language: languageSummary(source["language"]),
    languageCode: stringOf(source, "language_code"),
    isTemplate: booleanOf(source, "is_template"),
    filename: stringOf(source, "filename"),
    total: numberOf(source, "total"),
    translated: numberOf(source, "translated"),
    translatedPercent: numberOf(source, "translated_percent"),
    totalWords: numberOf(source, "total_words"),
    translatedWords: numberOf(source, "translated_words"),
    fuzzy: numberOf(source, "fuzzy"),
    fuzzyPercent: numberOf(source, "fuzzy_percent"),
    failingChecks: numberOf(source, "failing_checks"),
    failingChecksPercent: numberOf(source, "failing_checks_percent"),
    haveComment: numberOf(source, "have_comment"),
    haveSuggestion: numberOf(source, "have_suggestion"),
    lastAuthor: stringOf(source, "last_author"),
    lastChange: stringOf(source, "last_change"),
    translateUrl: stringOf(source, "translate_url"),
    webUrl: stringOf(source, "web_url"),
  });
}

function statisticsSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    name: stringOf(source, "name"),
    code: stringOf(source, "code"),
    total: numberOf(source, "total"),
    translated: numberOf(source, "translated"),
    translatedPercent: numberOf(source, "translated_percent"),
    totalWords: numberOf(source, "total_words"),
    translatedWords: numberOf(source, "translated_words"),
    fuzzy: numberOf(source, "fuzzy"),
    fuzzyPercent: numberOf(source, "fuzzy_percent"),
    failing: numberOf(source, "failing"),
    failingPercent: numberOf(source, "failing_percent"),
    lastAuthor: stringOf(source, "last_author"),
    lastChange: stringOf(source, "last_change"),
    translateUrl: stringOf(source, "translate_url"),
  });
}

/**
 * One localization string, normalized: the agent needs the source, the current
 * translation, where the string lives and what Weblate thinks of it, and it
 * needs to know when a value was cut.
 */
function unitSummary(
  value: unknown,
  context: WeblateProjectionContext,
): Record<string, unknown> {
  const source = recordOf(value);
  const ref = translationRef(source["translation"], context.origin);
  const text = boundedStrings(source["source"], context.textLimit);
  const target = boundedStrings(source["target"], context.textLimit);
  const previous = boundedStrings(source["previous_source"], context.textLimit);
  return compact({
    id: numberOf(source, "id"),
    project: ref?.["project"],
    component: ref?.["component"],
    language: stringOf(source, "language_code") ?? ref?.["language"],
    state: unitState(source["state"]),
    fuzzy: booleanOf(source, "fuzzy"),
    translated: booleanOf(source, "translated"),
    approved: booleanOf(source, "approved"),
    pending: booleanOf(source, "pending"),
    automaticallyTranslated: booleanOf(source, "automatically_translated"),
    source: text.items,
    target: target.items,
    previousSource: previous.items.length === 0 ? undefined : previous.items,
    textTruncated: text.truncated || target.truncated ? true : undefined,
    context: stringOf(source, "context"),
    note: stringOf(source, "note"),
    explanation: stringOf(source, "explanation"),
    location: stringOf(source, "location"),
    flags: stringOf(source, "flags"),
    priority: numberOf(source, "priority"),
    numWords: numberOf(source, "num_words"),
    position: numberOf(source, "position"),
    hasSuggestion: booleanOf(source, "has_suggestion"),
    hasComment: booleanOf(source, "has_comment"),
    hasFailingCheck: booleanOf(source, "has_failing_check"),
    labels: labelNamesOf(source, "labels"),
    sourceUnitId: unitIdOf(source["source_unit"], context.origin),
    webUrl: sameOriginUrl(source["web_url"], context.origin),
    timestamp: stringOf(source, "timestamp"),
    lastUpdated: stringOf(source, "last_updated"),
  });
}

function commentSummary(
  value: unknown,
  context: WeblateProjectionContext,
): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: numberOf(source, "id"),
    comment: stringOf(source, "comment"),
    // A comment is upstream-authored text like any other: bounded like one and
    // never treated as an instruction.
    author: usernameOf(source["user"], context.origin),
    timestamp: stringOf(source, "timestamp"),
  });
}

function suggestionSummary(
  value: unknown,
  context: WeblateProjectionContext,
): Record<string, unknown> {
  const source = recordOf(value);
  const target = boundedStrings(source["target"], context.textLimit);
  return compact({
    id: numberOf(source, "id"),
    target: target.items,
    textTruncated: target.truncated ? true : undefined,
    votes: numberOf(source, "votes"),
    author: usernameOf(source["user"], context.origin),
    timestamp: stringOf(source, "timestamp"),
  });
}

function changeSummary(
  value: unknown,
  context: WeblateProjectionContext,
): Record<string, unknown> {
  const source = recordOf(value);
  const translation = translationRef(source["translation"], context.origin);
  return compact({
    id: numberOf(source, "id"),
    action: numberOf(source, "action"),
    actionName: stringOf(source, "action_name"),
    target: stringOf(source, "target"),
    unitId: unitIdOf(source["unit"], context.origin),
    project: translation?.["project"],
    component: translation?.["component"],
    language: translation?.["language"],
    author: usernameOf(source["author"], context.origin),
    user: usernameOf(source["user"], context.origin),
    timestamp: stringOf(source, "timestamp"),
    // The old and new values are translation text: bounded, and reported as the
    // untrusted content they are.
    old: clip(stringOf(source, "old") ?? "", context.textLimit) || undefined,
    new: clip(stringOf(source, "new") ?? "", context.textLimit) || undefined,
  });
}

function screenshotSummary(
  value: unknown,
  context: WeblateProjectionContext,
): Record<string, unknown> {
  const source = recordOf(value);
  const translation = translationRef(source["translation"], context.origin);
  const unitIds = stringsOfRaw(source["units"])
    .map((unit) => unitIdOf(unit, context.origin))
    .filter((id): id is number => id !== undefined)
    .slice(0, SCREENSHOT_UNIT_LIMIT);
  return compact({
    id: numberOf(source, "id"),
    name: stringOf(source, "name"),
    repositoryFilename: stringOf(source, "repository_filename"),
    project: translation?.["project"],
    component: translation?.["component"],
    language: translation?.["language"],
    unitIds: unitIds.length === 0 ? undefined : unitIds,
    // The address of the image on the configured instance. The provider hands it
    // over as metadata only: it does not download screenshot bodies.
    fileUrl: sameOriginUrl(source["file_url"], context.origin),
    webUrl: sameOriginUrl(source["web_url"], context.origin),
  });
}

function stringsOfRaw(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export const WEBLATE_PROJECTIONS: Readonly<Record<string, WeblateProjection>> =
  Object.freeze({
    "connection.get": (data) => {
      const { account, resolved } = accountFromUsers(data);
      return {
        account,
        // False means the token may list users, so this provider cannot say
        // which account it belongs to; nothing is guessed from the first row.
        accountResolved: resolved,
      };
    },
    "projects.list": (data) =>
      (Array.isArray(data) ? data : []).map(projectSummary),
    "projects.get": (data) => projectSummary(data),
    "projects.statistics": (data) => statisticsSummary(data),
    "components.list": (data) =>
      (Array.isArray(data) ? data : []).map(componentSummary),
    "components.get": (data) => componentSummary(data),
    "components.statistics": (data) => statisticsSummary(data),
    "translations.list": (data) =>
      (Array.isArray(data) ? data : []).map(translationSummary),
    "translations.get": (data) => translationSummary(data),
    "translations.statistics": (data) => statisticsSummary(data),
    "units.search": (data, context) =>
      (Array.isArray(data) ? data : []).map((unit) =>
        unitSummary(unit, context),
      ),
    "units.find": (data, context) =>
      (Array.isArray(data) ? data : []).map((unit) =>
        unitSummary(unit, context),
      ),
    "units.get": (data, context) => unitSummary(data, context),
    "units.comments": (data, context) =>
      (Array.isArray(data) ? data : []).map((comment) =>
        commentSummary(comment, context),
      ),
    "units.suggestions": (data, context) =>
      (Array.isArray(data) ? data : []).map((suggestion) =>
        suggestionSummary(suggestion, context),
      ),
    "units.failing": (data, context) =>
      (Array.isArray(data) ? data : []).map((unit) =>
        unitSummary(unit, context),
      ),
    "changes.list": (data, context) =>
      (Array.isArray(data) ? data : []).map((change) =>
        changeSummary(change, context),
      ),
    "screenshots.list": (data, context) =>
      (Array.isArray(data) ? data : []).map((screenshot) =>
        screenshotSummary(screenshot, context),
      ),
    "screenshots.get": (data, context) => screenshotSummary(data, context),
  });

/**
 * Operations whose answer carries upstream-authored localization text. The
 * marker is what tells a reader of the raw JSON that the strings inside were
 * written by people on the far side and are data to them, never instructions.
 */
export const WEBLATE_UNTRUSTED_OPERATIONS: readonly string[] = Object.freeze([
  "units.search",
  "units.find",
  "units.get",
  "units.failing",
  "units.comments",
  "units.suggestions",
  "changes.list",
]);

/** Character budget of one string in the answer of this operation. */
export function textLimitFor(
  operation: string,
  requested: unknown,
  flags: WeblateFlags,
): number {
  if (operation !== "units.get") return SUMMARY_TEXT_CHARS;
  const asked = optionalInteger(requested, "maxChars", 128, 20_000);
  return Math.min(asked ?? flags.maxTextChars, flags.maxTextChars);
}
