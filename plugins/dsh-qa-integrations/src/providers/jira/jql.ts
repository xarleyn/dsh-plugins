import {
  optionalInteger,
  requiredStringList,
  requiredText,
} from "../../coerce.js";
import { IntegrationError } from "../../errors.js";
import { SEARCH_PAGE_CAP, type JiraFlags } from "./config.js";

/**
 * JQL is a query language, and this provider deliberately does not hand it to
 * the model: tools carry typed filters and the builder turns them into one
 * query. Everything below exists so that a filter value — however hostile —
 * stays a value: it is quoted, escaped and length-bounded, and a clause of its
 * own can never be smuggled in through a text fragment or a label.
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
 * checked for "one identifier token" rather than for a specific alphabet. That
 * also refuses a display name, which Jira Cloud would match against nothing and
 * answer with an empty page — "no such issues" instead of "wrong kind of
 * filter" is the one answer a search tool must not give by accident.
 */
const ACCOUNT_ID = /^[A-Za-z0-9:_.@-]{8,128}$/u;
/** An opaque continuation token Jira minted for this exact query. */
const PAGE_TOKEN = /^[A-Za-z0-9._~+/=-]{1,4096}$/u;

function invalid(field: string): never {
  throw new IntegrationError("InvalidRequest", `${field} is invalid`);
}

/** One JQL string literal: quoted, with the quote and the backslash escaped. */
export function jqlLiteral(value: string, field: string): string {
  const normalized = requiredText(value, field, 1, 200);
  if (CONTROL.test(normalized)) invalid(field);
  const escaped = normalized.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
  return `"${escaped}"`;
}

/**
 * A Jira date or timestamp as JQL takes it. A bare date stays a date; anything
 * with a time is rendered as Jira's `yyyy-MM-dd HH:mm`, which is the format the
 * language accepts (an ISO `T`/`Z` would be a syntax error).
 */
export function jqlDateTime(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 10, 40);
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
 * Who to filter on: the connected user (`me`), or an account id a previous
 * answer reported. A display name is refused on purpose — Jira Cloud would match
 * it against nothing and answer an empty page, which reads like "no such issues"
 * rather than "wrong kind of filter".
 */
function userFilter(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim().toLowerCase() === "me") {
    return "currentUser()";
  }
  const normalized = requiredText(value, field, 8, 128);
  if (!ACCOUNT_ID.test(normalized)) {
    throw new IntegrationError(
      "InvalidRequest",
      `${field} must be "me" or the accountId an issue reported`,
    );
  }
  return jqlLiteral(normalized, field);
}

/** A free-text fragment: a phrase when it has spaces, a word otherwise. */
export function textFilter(value: unknown): string {
  const normalized = requiredText(value, "query", 1, 200);
  if (CONTROL.test(normalized)) invalid("query");
  const escaped = normalized.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
  return normalized.includes(" ")
    ? `text ~ "\\"${escaped}\\""`
    : `text ~ "${escaped}"`;
}

function list(values: unknown, field: string): string[] {
  return requiredStringList(values, field, 20, 100);
}

/** A final check that no filter produced a bare control character. */
function checkClean(jql: string): string {
  if (CONTROL.test(jql)) invalid("query");
  return jql;
}

/**
 * Build the one JQL query behind `jira_search_issues`. The model contributes
 * values only; the operators, the clauses and the ordering are decided here, so
 * "OR project = SECRET" is a text fragment to search for rather than a clause
 * that widens the search.
 */
export function buildJql(input: Readonly<Record<string, unknown>>): string {
  const clauses: string[] = [];

  if (input["query"] !== undefined) {
    clauses.push(textFilter(input["query"]));
  }
  if (input["projectKeys"] !== undefined) {
    const keys = list(input["projectKeys"], "projectKeys").map((key) =>
      projectKey(key),
    );
    clauses.push(
      `project in (${keys.map((key) => jqlLiteral(key, "projectKeys")).join(", ")})`,
    );
  }
  if (input["statuses"] !== undefined) {
    const statuses = list(input["statuses"], "statuses").map((status) =>
      jqlLiteral(status, "statuses"),
    );
    clauses.push(`status in (${statuses.join(", ")})`);
  }
  if (input["assignee"] !== undefined) {
    clauses.push(`assignee = ${userFilter(input["assignee"], "assignee")}`);
  }
  if (input["reporter"] !== undefined) {
    clauses.push(`reporter = ${userFilter(input["reporter"], "reporter")}`);
  }
  if (input["labels"] !== undefined) {
    // One equality per label, ANDed: "has all of these" is what a person means
    // by a label filter, while Jira's own `in` would answer "any of these".
    for (const label of list(input["labels"], "labels")) {
      clauses.push(`labels = ${jqlLiteral(label, "labels")}`);
    }
  }
  if (input["updatedAfter"] !== undefined) {
    clauses.push(
      `updated >= ${jqlDateTime(input["updatedAfter"], "updatedAfter")}`,
    );
  }
  if (input["createdAfter"] !== undefined) {
    clauses.push(
      `created >= ${jqlDateTime(input["createdAfter"], "createdAfter")}`,
    );
  }

  if (clauses.length === 0) {
    // An empty JQL is refused by Jira Cloud anyway, and "every issue of the
    // site" is not a question this provider answers by default.
    throw new IntegrationError(
      "InvalidRequest",
      "search needs at least one filter: query, projectKeys, statuses, assignee, reporter, labels, updatedAfter or createdAfter",
    );
  }
  return checkClean(`${clauses.join(" AND ")} ORDER BY updated DESC`);
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
  const normalized = requiredText(value, "cursor", 1, 4_096);
  if (!PAGE_TOKEN.test(normalized)) invalid("cursor");
  return normalized;
}
