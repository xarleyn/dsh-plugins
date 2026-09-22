import {
  invalid,
  optionalBoolean,
  optionalInteger,
  requiredStringList,
  requiredText,
} from "../../coerce.js";
import { IntegrationError } from "../../errors.js";
import {
  CUSTOM_FIELD_ID,
  SEARCH_PAGE_CAP,
  type JiraDeployment,
  type JiraFlags,
} from "./config.js";

/**
 * JQL is a query language, and this provider deliberately does not hand it to
 * the model: tools carry typed filters and the builder turns them into one
 * query. Everything below exists so that a filter value — however hostile —
 * stays a value: it is quoted, escaped and length-bounded, and a clause of its
 * own can never be smuggled in through a text fragment, a label or a custom
 * field value.
 *
 * The filter vocabulary mirrors what a person asks a corporate Jira for:
 * project, type, status and its category, priority, resolution, components,
 * labels, fix and affected versions, the people, the dates, the history, and
 * the custom fields an instance defines.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;
/** Jira project keys start with a letter; the rest is alphanumerics and `_`. */
const PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/u;
/** Issue keys are a project key, a dash and a number: `PROJ-123`. */
const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}-\d{1,10}$/u;
/**
 * Atlassian account ids are opaque strings that have historically been 24 hex
 * characters, but some carry other alphanumerics and a colon, so the shape is
 * checked for "one identifier token" rather than for a specific alphabet. A
 * person's name fails it and is resolved through Jira's user search instead.
 */
const ACCOUNT_ID = /^[A-Za-z0-9:_.@-]{8,128}$/u;
/**
 * A Server / Data Center user name, which is what its JQL filters on. It is
 * shorter and freer than a Cloud account id (an administrator may keep mail
 * addresses as logins), so it is checked as "one identifier token" rather than
 * against a specific alphabet.
 */
const USER_NAME = /^[A-Za-z0-9._@+-]{1,255}$/u;
/** An opaque continuation token Jira minted for this exact query. */
const PAGE_TOKEN = /^[A-Za-z0-9._~+/=-]{1,4096}$/u;
/** A row offset on a product that pages a search by position. */
const PAGE_OFFSET = /^\d{1,7}$/u;
/** Deepest offset a search may walk to; search pagination is not a crawl API. */
const MAX_PAGE_START = 10_000;
/** Jira's own relative date tokens: `-3w`, `-2d`, `-4h`, `-30m`. */
const RELATIVE_DATE = /^-\d{1,4}[wdhm]$/u;
/** Status categories are the three Jira defines, not a workflow state. */
const STATUS_CATEGORIES = ["To Do", "In Progress", "Done"] as const;
/** How many words one free-text query may carry. */
const TEXT_TERMS = 12;
/** How many custom-field clauses one search may carry. */
const CUSTOM_FIELD_CLAUSES = 5;

/** One JQL string literal: quoted, with the quote and the backslash escaped. */
export function jqlLiteral(value: string, field: string): string {
  const normalized = requiredText(value, field, 1, 200);
  if (CONTROL.test(normalized)) invalid(field);
  return `"${escapeLiteral(normalized)}"`;
}

function escapeLiteral(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

/**
 * A Jira date or timestamp as JQL takes it. A bare date stays a date; a signed
 * token such as `-3w` stays Jira's own relative date, unquoted, because that is
 * what the language expects; anything with a time is rendered as Jira's
 * `yyyy-MM-dd HH:mm`, since an ISO `T`/`Z` would be a syntax error.
 */
export function jqlDateValue(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 2, 40);
  if (RELATIVE_DATE.test(normalized)) return normalized;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    if (Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) invalid(field);
    return `"${normalized}"`;
  }
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) invalid(field);
  const at = new Date(parsed);
  const pad = (part: number) => String(part).padStart(2, "0");
  const stamp = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
  return `"${stamp}"`;
}

export function projectKey(value: unknown, field = "projectKeys"): string {
  const normalized = requiredText(value, field, 1, 32);
  if (!PROJECT_KEY.test(normalized)) invalid(field);
  return normalized.toUpperCase();
}

export function issueKey(value: unknown, field = "issueKey"): string {
  const normalized = requiredText(value, field, 3, 48);
  if (!ISSUE_KEY.test(normalized)) {
    throw new IntegrationError(
      "InvalidRequest",
      `${field} must look like PROJ-123`,
    );
  }
  return normalized.toUpperCase();
}

/**
 * A filter value that is a person: the connected user (`me`), or the identifier
 * the site's JQL filters on — an account id on Cloud, a user name on Server /
 * Data Center. A display name is refused here on purpose — Jira would match it
 * against nothing and answer an empty page, which reads like "no such issues"
 * rather than "wrong kind of filter". The provider resolves a name into that
 * identifier before the builder ever sees it, so a name reaching this point
 * means the lookup did not happen.
 */
function userFilter(
  value: unknown,
  field: string,
  deployment: JiraDeployment,
): string {
  if (typeof value === "string" && value.trim().toLowerCase() === "me") {
    return "currentUser()";
  }
  const server = deployment === "server";
  const normalized = requiredText(value, field, server ? 1 : 8, 255);
  const shape = server ? USER_NAME : ACCOUNT_ID;
  if (!shape.test(normalized)) {
    throw new IntegrationError(
      "InvalidRequest",
      `${field} must be "me" or the ${identifierName(deployment)} an issue reported`,
    );
  }
  return jqlLiteral(normalized, field);
}

/** What this product calls the identifier a person filter takes. */
export function identifierName(deployment: JiraDeployment): string {
  return deployment === "server" ? "user name" : "accountId";
}

/**
 * Whether a person filter needs the directory before it becomes JQL: `me` and
 * an already-shaped identifier are unambiguous, a free-text name is not.
 */
export function needsUserLookup(
  value: unknown,
  deployment: JiraDeployment,
): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (normalized === "" || normalized.toLowerCase() === "me") return false;
  return !(deployment === "server" ? USER_NAME : ACCOUNT_ID).test(normalized);
}

/** One free-text fragment: every word searched, or the exact phrase. */
export function textClauses(
  value: unknown,
  match: "all" | "phrase" | undefined,
): string[] {
  const normalized = requiredText(value, "query", 1, 200);
  if (CONTROL.test(normalized)) invalid("query");
  if (match === "phrase") {
    return [`text ~ "\\"${escapeLiteral(normalized)}\\""`];
  }
  const terms = normalized.split(/\s+/u).filter((term) => term !== "");
  if (terms.length === 0 || terms.length > TEXT_TERMS) invalid("query");
  return terms.map((term) => `text ~ "${escapeLiteral(term)}"`);
}

function textValues(values: unknown, field: string): string[] {
  return requiredStringList(values, field, 20, 100);
}

/** `field = "a"`, one clause per value, so several values are ANDed. */
function equalsClauses(field: string, values: string[]): string[] {
  return values.map((value) => `${field} = ${jqlLiteral(value, field)}`);
}

/** `field in ("a", "b")`, the form Jira answers as a set filter. */
function inClause(field: string, values: string[]): string {
  return `${field} in (${values.map((value) => jqlLiteral(value, field)).join(", ")})`;
}

/** A version-like field: named versions, or the empty/not-empty marker. */
function versionClauses(
  field: string,
  values: unknown,
  empty: unknown,
  labels: { readonly list: string; readonly marker: string },
): string[] {
  const isEmpty = optionalBoolean(empty, labels.marker);
  if (values === undefined) {
    if (isEmpty === undefined) return [];
    return [`${field} IS ${isEmpty ? "" : "NOT "}EMPTY`];
  }
  if (isEmpty === true) {
    // Asking for named versions and for "none at all" cannot both be answered.
    throw new IntegrationError(
      "InvalidRequest",
      `${labels.list} and ${labels.marker} contradict each other`,
    );
  }
  return [inClause(field, textValues(values, labels.list))];
}

/**
 * One custom-field constraint. The field is named by id — the one
 * `jira_get_fields` returned — and the value is escaped like any other, so an
 * instance field can be queried without putting JQL in the model's hands.
 */
export interface CustomFieldClause {
  readonly field: string;
  readonly value?: string;
  readonly empty?: boolean;
  readonly match?: "equals" | "contains";
}

function customFieldClauses(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) invalid("customFields");
  if (value.length > CUSTOM_FIELD_CLAUSES) invalid("customFields");
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      invalid("customFields");
    }
    const record = entry as Record<string, unknown>;
    const field = requiredText(record["field"], "customFields.field", 13, 32);
    if (!CUSTOM_FIELD_ID.test(field)) {
      throw new IntegrationError(
        "InvalidRequest",
        "customFields.field must be the customfield_ id jira_get_fields reported, or an alias this deployment configured",
      );
    }
    const isEmpty = optionalBoolean(record["empty"], "customFields.empty");
    if (isEmpty !== undefined) {
      return `${field} IS ${isEmpty ? "" : "NOT "}EMPTY`;
    }
    const raw = requiredText(record["value"], "customFields.value", 1, 200);
    const match = record["match"];
    if (match !== undefined && match !== "equals" && match !== "contains") {
      invalid("customFields.match");
    }
    return match === "contains"
      ? `${field} ~ ${jqlLiteral(raw, "customFields.value")}`
      : `${field} = ${jqlLiteral(raw, "customFields.value")}`;
  });
}

function statusCategoryClauses(value: unknown): string[] {
  return textValues(value, "statusCategories").map((entry) => {
    const wanted = STATUS_CATEGORIES.find(
      (category) => category.toLowerCase() === entry.toLowerCase(),
    );
    if (wanted === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        `statusCategories accepts ${STATUS_CATEGORIES.join(", ")}`,
      );
    }
    return `statusCategory = ${jqlLiteral(wanted, "statusCategories")}`;
  });
}

/** The match mode of a free-text query: every word, or the exact phrase. */
export function textMatch(value: unknown): "all" | "phrase" {
  if (value === undefined) return "all";
  const normalized = requiredText(value, "match", 3, 6);
  if (normalized !== "all" && normalized !== "phrase") invalid("match");
  return normalized;
}

/**
 * Build the one JQL query behind `jira_search_issues`. The model contributes
 * values only; the operators, the clauses and the ordering are decided here, so
 * "OR project = SECRET" is a text fragment to search for rather than a clause
 * that widens the search.
 */
export function buildJql(
  input: Readonly<Record<string, unknown>>,
  deployment: JiraDeployment = "cloud",
): string {
  const clauses: string[] = [];

  if (input["query"] !== undefined) {
    clauses.push(...textClauses(input["query"], textMatch(input["match"])));
  }
  if (input["projectKeys"] !== undefined) {
    clauses.push(
      inClause(
        "project",
        textValues(input["projectKeys"], "projectKeys").map((key) =>
          projectKey(key),
        ),
      ),
    );
  }
  if (input["issueTypes"] !== undefined) {
    clauses.push(
      inClause("issuetype", textValues(input["issueTypes"], "issueTypes")),
    );
  }
  if (input["statuses"] !== undefined) {
    clauses.push(inClause("status", textValues(input["statuses"], "statuses")));
  }
  if (input["statusCategories"] !== undefined) {
    clauses.push(...statusCategoryClauses(input["statusCategories"]));
  }
  if (input["priorities"] !== undefined) {
    clauses.push(
      inClause("priority", textValues(input["priorities"], "priorities")),
    );
  }
  if (input["resolutions"] !== undefined) {
    clauses.push(
      inClause("resolution", textValues(input["resolutions"], "resolutions")),
    );
  }
  if (input["components"] !== undefined) {
    clauses.push(
      inClause("component", textValues(input["components"], "components")),
    );
  }
  if (input["labels"] !== undefined) {
    // One equality per label, ANDed: "has all of these" is what a person means
    // by a label filter, while Jira's own `in` would answer "any of these".
    clauses.push(
      ...equalsClauses("labels", textValues(input["labels"], "labels")),
    );
  }
  clauses.push(
    ...versionClauses(
      "fixVersion",
      input["fixVersions"],
      input["fixVersionEmpty"],
      { list: "fixVersions", marker: "fixVersionEmpty" },
    ),
  );
  clauses.push(
    ...versionClauses(
      "affectedVersion",
      input["affectedVersions"],
      input["affectedVersionEmpty"],
      { list: "affectedVersions", marker: "affectedVersionEmpty" },
    ),
  );
  if (input["assignee"] !== undefined) {
    clauses.push(
      `assignee = ${userFilter(input["assignee"], "assignee", deployment)}`,
    );
  }
  if (input["reporter"] !== undefined) {
    clauses.push(
      `reporter = ${userFilter(input["reporter"], "reporter", deployment)}`,
    );
  }
  if (input["createdAfter"] !== undefined) {
    clauses.push(
      `created >= ${jqlDateValue(input["createdAfter"], "createdAfter")}`,
    );
  }
  if (input["createdBefore"] !== undefined) {
    clauses.push(
      `created <= ${jqlDateValue(input["createdBefore"], "createdBefore")}`,
    );
  }
  if (input["updatedAfter"] !== undefined) {
    clauses.push(
      `updated >= ${jqlDateValue(input["updatedAfter"], "updatedAfter")}`,
    );
  }
  if (input["updatedBefore"] !== undefined) {
    clauses.push(
      `updated <= ${jqlDateValue(input["updatedBefore"], "updatedBefore")}`,
    );
  }
  if (input["customFields"] !== undefined) {
    clauses.push(...customFieldClauses(input["customFields"]));
  }

  if (clauses.length === 0) {
    // An empty JQL is refused by Jira Cloud anyway, and "every issue of the
    // site" is not a question this provider answers by default.
    throw new IntegrationError(
      "InvalidRequest",
      "search needs at least one filter: query, projectKeys, issueTypes, statuses, statusCategories, priorities, resolutions, components, labels, fixVersions, affectedVersions, assignee, reporter, createdAfter, createdBefore, updatedAfter, updatedBefore or customFields",
    );
  }
  const jql = `${clauses.join(" AND ")} ORDER BY updated DESC`;
  if (CONTROL.test(jql)) invalid("query");
  return jql;
}

/**
 * Rows of one search page: the model may lower the deployment's default but
 * never raise its ceiling.
 */
export function searchLimit(requested: unknown, flags: JiraFlags): number {
  const asked = optionalInteger(requested, "limit", 1, SEARCH_PAGE_CAP);
  return Math.min(
    asked ?? flags.defaultSearchLimit,
    flags.maxSearchLimit,
    SEARCH_PAGE_CAP,
  );
}

/** Rows of one comment page, capped the same way. */
export function commentLimit(requested: unknown, flags: JiraFlags): number {
  const asked = optionalInteger(requested, "limit", 1, SEARCH_PAGE_CAP);
  return Math.min(asked ?? flags.maxCommentLimit, flags.maxCommentLimit);
}

/** The offset of a comment page; Jira still pages comments by position. */
export function commentStart(value: unknown): number {
  return optionalInteger(value, "startAt", 0) ?? 0;
}

/** An opaque continuation token from a previous search answer. */
export function pageToken(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = requiredText(value, "cursor", 1, 4096);
  if (!PAGE_TOKEN.test(normalized)) invalid("cursor");
  return normalized;
}

/**
 * The row offset a Server / Data Center search continues from. Its cursor is
 * the position the previous answer ended at — the product pages a search by
 * offset, and reports the size of the answer rather than minting a token — so
 * the cursor is a decimal number and a bounded one, because search pagination
 * is not a crawl API.
 */
export function pageOffset(value: unknown): number {
  if (value === undefined) return 0;
  const normalized = requiredText(value, "cursor", 1, 7);
  if (!PAGE_OFFSET.test(normalized)) invalid("cursor");
  const offset = Number(normalized);
  if (!Number.isFinite(offset) || offset > MAX_PAGE_START) invalid("cursor");
  return offset;
}
