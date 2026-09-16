import { optionalText, requiredText } from "../../coerce.js";
import { IntegrationError } from "../../errors.js";
import { bodyText } from "./adf.js";
import type { JiraFlags, JiraSite } from "./config.js";
import {
  buildJql,
  commentLimit,
  commentStart,
  issueKey as issueKeyOf,
  pageToken,
  projectKey as projectKeyOf,
  searchLimit,
} from "./jql.js";
import type { JiraQuery } from "./transport.js";

function invalid(field: string): never {
  throw new IntegrationError("InvalidRequest", `${field} is invalid`);
}

/** What a search answer carries about every issue it returns. */
export const SEARCH_FIELDS: readonly string[] = Object.freeze([
  "summary",
  "status",
  "priority",
  "assignee",
  "reporter",
  "labels",
  "created",
  "updated",
  "duedate",
  "resolution",
  "project",
  "issuetype",
  "parent",
]);

/** The fields every issue read answers with, whatever else was asked for. */
const CORE_FIELDS: readonly string[] = Object.freeze([
  "summary",
  "status",
  "priority",
  "assignee",
  "reporter",
  "labels",
  "created",
  "updated",
  "duedate",
  "resolution",
  "resolutiondate",
  "project",
  "issuetype",
]);

/** Optional groups `jira_get_issue` can add to the core card. */
export const ISSUE_INCLUDES: readonly string[] = Object.freeze([
  "description",
  "comments_summary",
  "attachments",
  "relations",
  "custom_fields",
]);

/** Newest first is what a person asks for unless they say otherwise. */
const COMMENT_ORDERS: readonly string[] = Object.freeze(["newest", "oldest"]);

export interface OperationContext {
  /**
   * Atlassian account id of the connection owner, read from the stored
   * integration. Reserved for "mine" defaults Jira cannot express with a
   * keyword; no operation substitutes it for a model argument.
   */
  readonly externalUserId?: string | undefined;
  readonly flags: JiraFlags;
}

export interface JiraRequest {
  readonly path: string;
  readonly query: JiraQuery;
}

export type JiraOperationHandler = (
  input: Readonly<Record<string, unknown>>,
  context: OperationContext,
) => JiraRequest;

function issuePath(suffix = ""): string {
  return `/rest/api/3/issue/:issueKey${suffix}`;
}

function withIssue(template: string, value: unknown): string {
  return template.replace(":issueKey", issueKeyOf(value));
}

/** The include groups a `jira_get_issue` call asked for, in catalog order. */
export function requestedIncludes(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze(["description"]);
  if (!Array.isArray(value) || value.length === 0) invalid("include");
  const wanted: string[] = [];
  for (const item of value) {
    const name = requiredText(item, "include", 3, 32);
    if (!ISSUE_INCLUDES.includes(name)) invalid("include");
    if (!wanted.includes(name)) wanted.push(name);
  }
  return wanted;
}

/**
 * The `fields` selector of one issue read. Custom fields are the one group Jira
 * only answers in full, so asking for them switches the selector to `*all`;
 * everything else is an explicit list, which is what keeps an issue read from
 * dragging the whole site schema into the answer.
 *
 * Custom fields are also the group that depends on the site's field catalog, so
 * a deployment that switched that catalog off refuses them here rather than
 * answering with a page of `customfield_…` ids nobody can interpret.
 */
export function issueFields(
  include: readonly string[],
  flags: JiraFlags,
): string {
  if (include.includes("custom_fields")) {
    if (!flags.fieldsRead) {
      throw new IntegrationError(
        "InvalidRequest",
        "This deployment disabled the Jira field catalog, so custom_fields cannot be requested",
      );
    }
    return "*all";
  }
  const fields = new Set<string>(CORE_FIELDS);
  if (include.includes("description")) fields.add("description");
  if (include.includes("relations")) {
    fields.add("parent");
    fields.add("subtasks");
    fields.add("issuelinks");
  }
  if (include.includes("attachments")) fields.add("attachment");
  if (include.includes("comments_summary")) fields.add("comment");
  return [...fields].join(",");
}

/** Whether an issue read needs the site's field schema to name custom fields. */
export function wantsFieldNames(include: readonly string[]): boolean {
  return include.includes("custom_fields");
}

export const JIRA_HANDLERS: Readonly<Record<string, JiraOperationHandler>> =
  Object.freeze({
    "connection.get": () => ({ path: "/rest/api/3/myself", query: {} }),

    "issues.search": (input, context) => ({
      path: "/rest/api/3/search/jql",
      query: {
        jql: buildJql(input),
        maxResults: searchLimit(input["limit"], context.flags),
        nextPageToken: pageToken(input["cursor"]),
        fields: SEARCH_FIELDS.join(","),
      },
    }),

    "issues.get": (input, context) => {
      const include = requestedIncludes(input["include"]);
      return {
        path: withIssue(issuePath(), input["issueKey"]),
        query: { fields: issueFields(include, context.flags) },
      };
    },

    "issues.comments": (input, context) => {
      const order = optionalText(input["order"], "order", 6, 6) ?? "newest";
      if (!COMMENT_ORDERS.includes(order)) invalid("order");
      return {
        path: withIssue(issuePath("/comment"), input["issueKey"]),
        query: {
          startAt: commentStart(input["startAt"]),
          maxResults: commentLimit(input["limit"], context.flags),
          orderBy: order === "oldest" ? "created" : "-created",
        },
      };
    },

    "issues.attachments": (input) => ({
      path: withIssue(issuePath(), input["issueKey"]),
      query: { fields: "attachment" },
    }),

    "issues.transitions": (input) => ({
      path: withIssue(issuePath("/transitions"), input["issueKey"]),
      // The expansion adds the fields each transition would need, which is what
      // makes the answer useful to a later write phase without executing one.
      query: { expand: "transitions.fields" },
    }),

    "projects.get": (input) => ({
      path: `/rest/api/3/project/${projectKeyOf(input["projectKey"])}`,
      query: {},
    }),

    "fields.list": () => ({ path: "/rest/api/3/field", query: {} }),
  });

/* ------------------------------------------------------------------ */
/* Response shaping                                                    */
/* ------------------------------------------------------------------ */

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
  return typeof value === "string" ? value : undefined;
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

function arrayOf(source: Record<string, unknown>, key: string): unknown[] {
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Drop unset keys so a projection never answers with `undefined` holes. */
function compact(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  );
}

/** The one thing about an issue that is a person's to click. */
export function issueUrl(site: JiraSite, key: string): string {
  return `${site.baseUrl}/browse/${encodeURIComponent(key)}`;
}

function userSummary(value: unknown): Record<string, unknown> | undefined {
  const source = recordOf(value);
  const accountId = stringOf(source, "accountId");
  if (accountId === undefined) return undefined;
  return compact({
    accountId,
    displayName: stringOf(source, "displayName"),
  });
}

/** `{ id, name }` of a status, priority, resolution, type or link kind. */
function namedRef(
  value: unknown,
  extra?: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const source = recordOf(value);
  const id = stringOf(source, "id");
  const name = stringOf(source, "name");
  if (id === undefined && name === undefined) return undefined;
  return compact({ id, name, ...(extra ?? {}) });
}

/** Jira calls the human-readable half of a status its category. */
function statusRef(value: unknown): Record<string, unknown> | undefined {
  const source = recordOf(value);
  if (Object.keys(source).length === 0) return undefined;
  return compact({
    id: stringOf(source, "id"),
    name: stringOf(source, "name"),
    category: stringOf(recordOf(source["statusCategory"]), "name"),
  });
}

function projectRef(value: unknown): Record<string, unknown> | undefined {
  const source = recordOf(value);
  if (Object.keys(source).length === 0) return undefined;
  return compact({
    id: stringOf(source, "id"),
    key: stringOf(source, "key"),
    name: stringOf(source, "name"),
  });
}

/**
 * One issue as the model sees it: the card every operation answers with. A
 * `parent` or a `subtask` is itself an issue object in Jira, so those recurse
 * through this same projection — and an optional association Jira did not send
 * is `undefined` rather than an empty card.
 */
function issueSummary(
  value: unknown,
  site: JiraSite,
): Record<string, unknown> | undefined {
  const source = recordOf(value);
  if (Object.keys(source).length === 0) return undefined;
  const fields = recordOf(source["fields"]);
  const key = stringOf(source, "key");
  const labels = strings(arrayOf(fields, "labels"));
  return compact({
    id: stringOf(source, "id"),
    key,
    url: key === undefined ? undefined : issueUrl(site, key),
    project: projectRef(fields["project"]),
    issueType: namedRef(fields["issuetype"]),
    summary: stringOf(fields, "summary"),
    status: statusRef(fields["status"]),
    priority: namedRef(fields["priority"]),
    resolution: namedRef(fields["resolution"]),
    assignee: userSummary(fields["assignee"]),
    reporter: userSummary(fields["reporter"]),
    labels: labels.length === 0 ? undefined : labels,
    createdAt: stringOf(fields, "created"),
    updatedAt: stringOf(fields, "updated"),
    dueAt: stringOf(fields, "duedate"),
  });
}

/** Metadata only: no attachment is ever downloaded by this provider. */
function attachmentSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    filename: stringOf(source, "filename"),
    mimeType: stringOf(source, "mimeType"),
    size: numberOf(source, "size"),
    author: userSummary(source["author"]),
    createdAt: stringOf(source, "created"),
  });
}

function commentSummary(
  value: unknown,
  flags: JiraFlags,
): Record<string, unknown> {
  const source = recordOf(value);
  const body = bodyText(source["body"], flags.maxTextChars);
  const visibility = recordOf(source["visibility"]);
  return compact({
    id: stringOf(source, "id"),
    author: userSummary(source["author"]),
    body: body.text,
    bodyTruncated: body.truncated ? true : undefined,
    // A restricted comment is one only some roles or groups may read; Jira has
    // already decided this answer is allowed, and the marker says why it may be
    // narrower than the rest.
    visibility:
      Object.keys(visibility).length === 0
        ? undefined
        : compact({
            type: stringOf(visibility, "type"),
            value: stringOf(visibility, "value"),
          }),
    createdAt: stringOf(source, "created"),
    updatedAt: stringOf(source, "updated"),
  });
}

/**
 * The fields a transition would ask for. Jira returns them only with
 * `expand=transitions.fields`, and only their names are kept: the shape of a
 * field belongs to the field catalog, and the transition is not executed here.
 */
function requiredFields(value: unknown): string[] {
  return Object.entries(recordOf(value))
    .filter(([, field]) => recordOf(field)["required"] === true)
    .map(([id, field]) => stringOf(recordOf(field), "name") ?? id);
}

function transitionSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    name: stringOf(source, "name"),
    to: namedRef(source["to"]),
    hasScreen: booleanOf(source, "hasScreen"),
    isAvailable: booleanOf(source, "isAvailable"),
    isConditional: booleanOf(source, "isConditional"),
    isInitial: booleanOf(source, "isInitial"),
    isGlobal: booleanOf(source, "isGlobal"),
    requiredFields: requiredFields(source["fields"]),
  });
}

function fieldSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const schema = recordOf(source["schema"]);
  return compact({
    id: stringOf(source, "id"),
    key: stringOf(source, "key"),
    name: stringOf(source, "name"),
    custom: booleanOf(source, "custom"),
    type: stringOf(schema, "type"),
    items: stringOf(schema, "items"),
    clauseNames: strings(arrayOf(source, "clauseNames")),
    navigable: booleanOf(source, "navigable"),
    searchable: booleanOf(source, "searchable"),
    orderable: booleanOf(source, "orderable"),
  });
}

/**
 * One custom field value, reduced to what the model can read: rich text becomes
 * text, a picker keeps its name, and a shape nothing here recognizes is rendered
 * as bounded JSON rather than dropped silently.
 */
export function customFieldValue(value: unknown, maxChars: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, maxChars);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => customFieldValue(item, maxChars));
  }
  const source = recordOf(value);
  if (Object.keys(source).length === 0) return null;
  const rendered = bodyText(value, maxChars);
  if (rendered.text !== "") {
    return rendered.truncated ? `${rendered.text}…` : rendered.text;
  }
  const picked = compact({
    id: stringOf(source, "id"),
    key: stringOf(source, "key"),
    name: stringOf(source, "name"),
    value: stringOf(source, "value"),
    displayName: stringOf(source, "displayName"),
    accountId: stringOf(source, "accountId"),
  });
  if (Object.keys(picked).length > 0) return picked;
  try {
    return JSON.stringify(value).slice(0, maxChars);
  } catch {
    return null;
  }
}

export interface JiraProjectionContext {
  readonly flags: JiraFlags;
  /** The configured site this answer came from, for the issue permalink. */
  readonly site: JiraSite;
  /** Groups a `jira_get_issue` call asked for. */
  readonly include: readonly string[];
  /** Field id to name, when the call resolved the site's field schema. */
  readonly fieldNames?: ReadonlyMap<string, string> | undefined;
  /** The issue a one-issue operation was asked about, when Jira omits it. */
  readonly issueKey?: string | undefined;
}

export type JiraProjection = (
  data: unknown,
  context: JiraProjectionContext,
) => unknown;

/** The custom fields of one issue, named when the schema is known. */
function customFieldsOf(
  fields: Record<string, unknown>,
  context: JiraProjectionContext,
): Record<string, unknown> {
  const named: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(fields)) {
    if (!id.startsWith("customfield_")) continue;
    if (value === null || value === undefined) continue;
    named[context.fieldNames?.get(id) ?? id] = customFieldValue(
      value,
      context.flags.maxTextChars,
    );
  }
  return named;
}

function issueDetail(
  data: unknown,
  context: JiraProjectionContext,
): Record<string, unknown> {
  const source = recordOf(data);
  const fields = recordOf(source["fields"]);
  const include = context.include;
  const description =
    fields["description"] === undefined
      ? undefined
      : bodyText(fields["description"], context.flags.maxTextChars);
  const comment = recordOf(fields["comment"]);
  return compact({
    ...issueSummary(source, context.site),
    description: description?.text,
    descriptionTruncated: description?.truncated ? true : undefined,
    ...(include.includes("comments_summary")
      ? {
          comments: compact({
            total: numberOf(comment, "total"),
            returned: arrayOf(comment, "comments").length,
          }),
        }
      : {}),
    ...(include.includes("attachments")
      ? {
          attachments: arrayOf(fields, "attachment").map((item) =>
            attachmentSummary(item),
          ),
        }
      : {}),
    ...(include.includes("relations")
      ? {
          parent: issueSummary(fields["parent"], context.site),
          subtasks: arrayOf(fields, "subtasks").map((item) =>
            issueSummary(item, context.site),
          ),
          links: arrayOf(fields, "issuelinks").map((item) => {
            const link = recordOf(item);
            const outward = recordOf(link["outwardIssue"]);
            const inward = recordOf(link["inwardIssue"]);
            const outwardFirst = Object.keys(outward).length > 0;
            const other = outwardFirst ? outward : inward;
            return compact({
              type: stringOf(recordOf(link["type"]), "name"),
              direction: outwardFirst ? "outward" : "inward",
              key: stringOf(other, "key"),
              summary: stringOf(recordOf(other["fields"]), "summary"),
            });
          }),
        }
      : {}),
    ...(include.includes("custom_fields")
      ? { customFields: customFieldsOf(fields, context) }
      : {}),
  });
}

export const JIRA_PROJECTIONS: Readonly<Record<string, JiraProjection>> =
  Object.freeze({
    "connection.get": (data) => {
      const source = recordOf(data);
      return compact({
        accountId: stringOf(source, "accountId"),
        displayName: stringOf(source, "displayName"),
        emailAddress: stringOf(source, "emailAddress"),
        accountType: stringOf(source, "accountType"),
        active: booleanOf(source, "active"),
        timeZone: stringOf(source, "timeZone"),
      });
    },
    "issues.search": (data, context) => {
      const source = recordOf(data);
      const issues = arrayOf(source, "issues");
      return compact({
        items: issues.map((item) => issueSummary(item, context.site)),
        pagination: compact({
          returned: issues.length,
          isLast: booleanOf(source, "isLast"),
          // The cursor is Jira's own continuation token: this provider keeps no
          // state between calls, so the model either continues with it or asks
          // a narrower question.
          nextCursor: stringOf(source, "nextPageToken"),
        }),
      });
    },
    "issues.get": issueDetail,
    "issues.comments": (data, context) => {
      const source = recordOf(data);
      const comments = arrayOf(source, "comments");
      const total = numberOf(source, "total");
      const startAt = numberOf(source, "startAt") ?? 0;
      return compact({
        items: comments.map((item) => commentSummary(item, context.flags)),
        pagination: compact({
          startAt,
          returned: comments.length,
          total,
          hasMore:
            total === undefined ? undefined : startAt + comments.length < total,
        }),
      });
    },
    "issues.attachments": (data, context) => {
      const source = recordOf(data);
      const attachments = arrayOf(recordOf(source["fields"]), "attachment");
      return compact({
        key: stringOf(source, "key") ?? context.issueKey,
        items: attachments.map((item) => attachmentSummary(item)),
        returned: attachments.length,
      });
    },
    "issues.transitions": (data, context) => {
      const transitions = arrayOf(recordOf(data), "transitions");
      return compact({
        // Jira's answer does not name the issue; the request does.
        key: context.issueKey,
        items: transitions.map(transitionSummary),
        returned: transitions.length,
      });
    },
    "projects.get": (data, context) => {
      const source = recordOf(data);
      const key = stringOf(source, "key");
      const description =
        source["description"] === undefined
          ? undefined
          : bodyText(source["description"], context.flags.maxTextChars);
      return compact({
        id: stringOf(source, "id"),
        key,
        name: stringOf(source, "name"),
        projectTypeKey: stringOf(source, "projectTypeKey"),
        simplified: booleanOf(source, "simplified"),
        isPrivate: booleanOf(source, "isPrivate"),
        lead: userSummary(source["lead"]),
        url: key === undefined ? undefined : issueUrl(context.site, key),
        description: description?.text,
        descriptionTruncated: description?.truncated ? true : undefined,
      });
    },
    "fields.list": (data) => {
      const fields = Array.isArray(data) ? data : [];
      return { items: fields.map(fieldSummary), returned: fields.length };
    },
  });
