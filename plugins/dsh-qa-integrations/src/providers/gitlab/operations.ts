import {
  invalid,
  optionalBoolean,
  optionalInteger,
  optionalText,
  requiredInteger,
  requiredStringList,
  requiredText,
} from "../../coerce.js";
import { IntegrationError } from "../../errors.js";
import { looksBinary } from "../shared/http.js";
import {
  arrayOf,
  booleanOf,
  compact,
  numberOf,
  recordOf,
  stringOf,
} from "../shared/payload.js";
import { hasTraversal } from "../shared/paths.js";
import type { GitlabFlags } from "./config.js";
import type { GitlabQuery } from "./transport.js";

/**
 * Name of a GitLab project as it appears in a path segment: either the numeric
 * id or a `namespace/project` path. Both are passed through URL-encoded, and
 * neither may carry a traversal or an extra segment, because this value ends up
 * inside the REST path.
 */
const PROJECT_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
const GROUP_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
const REF_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u;
const COMMIT_SHA = /^[0-9a-fA-F]{7,40}$/u;

/** A project id or path, canonicalized into one URL path segment. */
export function projectRef(value: unknown, field = "project"): string {
  if (typeof value === "number") {
    return String(requiredInteger(value, field));
  }
  if (typeof value !== "string") invalid(field);
  const normalized = value.trim().replace(/^\/+|\/+$/gu, "");
  if (
    normalized === "" ||
    normalized.length > 255 ||
    !PROJECT_PATH.test(normalized) ||
    hasTraversal(normalized)
  ) {
    invalid(field);
  }
  return encodeURIComponent(normalized);
}

export function groupRef(value: unknown, field = "group"): string {
  if (typeof value === "number") {
    return String(requiredInteger(value, field));
  }
  if (typeof value !== "string") invalid(field);
  const normalized = value.trim().replace(/^\/+|\/+$/gu, "");
  if (
    normalized === "" ||
    normalized.length > 255 ||
    !GROUP_PATH.test(normalized) ||
    hasTraversal(normalized)
  ) {
    invalid(field);
  }
  return encodeURIComponent(normalized);
}

/** Branch, tag or commit-ish; validated, never a path of its own. */
function refName(value: unknown, field = "ref"): string {
  const normalized = requiredText(value, field, 1, 255);
  if (
    !REF_NAME.test(normalized) ||
    hasTraversal(normalized) ||
    normalized.includes("//")
  ) {
    invalid(field);
  }
  return normalized;
}

function commitSha(value: unknown, field = "sha"): string {
  const normalized = requiredText(value, field, 7, 40);
  if (!COMMIT_SHA.test(normalized)) invalid(field);
  return normalized;
}

/** Repository path: the whole thing is one REST segment, so it is encoded. */
function filePath(value: unknown, field = "path"): string {
  const normalized = requiredText(value, field, 1, 512);
  if (
    normalized.startsWith("/") ||
    hasTraversal(normalized) ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f\\]/u.test(normalized)
  ) {
    invalid(field);
  }
  return encodeURIComponent(normalized);
}

/**
 * GitLab timestamps are ISO 8601, but a date is what a person usually has. A
 * bare date becomes midnight UTC, so "updated after 2026-09-01" is inclusive.
 */
function timestamp(value: unknown, field: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value.trim())) {
    const parsed = Date.parse(`${value.trim()}T00:00:00Z`);
    if (Number.isNaN(parsed)) invalid(field);
    return `${value.trim()}T00:00:00Z`;
  }
  const normalized = requiredText(value, field, 10, 40);
  if (Number.isNaN(Date.parse(normalized))) invalid(field);
  return normalized;
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : timestamp(value, field);
}

function labels(value: unknown, field = "labels"): string {
  return requiredStringList(value, field, 20, 100).join(",");
}

function optionalLabels(value: unknown, field = "labels"): string | undefined {
  return value === undefined ? undefined : labels(value, field);
}

function requiredIid(value: unknown, field: string): number {
  return requiredInteger(value, field);
}

/** Page and per-page, capped so one call can never ask for a whole instance. */
function pagination(
  input: Readonly<Record<string, unknown>>,
  maxPerPage: number,
): GitlabQuery {
  return {
    page: optionalInteger(input["page"], "page", 1) ?? 1,
    per_page: optionalInteger(input["perPage"], "perPage", 1, maxPerPage),
  };
}

function withPagination(
  query: GitlabQuery,
  input: Readonly<Record<string, unknown>>,
  maxPerPage: number,
): GitlabQuery {
  return { ...query, ...pagination(input, maxPerPage) };
}

export interface OperationContext {
  /**
   * GitLab numeric user id of the token owner, read from the stored
   * integration. Reserved for "mine" defaults that GitLab cannot express with a
   * scope keyword; no operation substitutes it for a model argument.
   */
  readonly externalUserId?: string | undefined;
  readonly flags: GitlabFlags;
}

export interface GitlabRequest {
  readonly path: string;
  readonly query: GitlabQuery;
}

export type GitlabOperationHandler = (
  input: Readonly<Record<string, unknown>>,
  context: OperationContext,
) => GitlabRequest;

const LIST_MAX_PER_PAGE = 100;

/**
 * Search scopes the model may name. GitLab spells code search `blobs`; the
 * catalog only allows the scopes it can actually honour, so a request for
 * advanced search degrades into a refusal instead of a broader search.
 */
export const SEARCH_SCOPES: readonly string[] = Object.freeze([
  "projects",
  "issues",
  "merge_requests",
  "commits",
  "blobs",
  "notes",
  "users",
]);

export const ISSUE_SCOPES: readonly string[] = Object.freeze([
  "created_by_me",
  "assigned_to_me",
  "all",
]);

export const MR_SCOPES: readonly string[] = Object.freeze([
  "created_by_me",
  "assigned_to_me",
  "all",
  "reviews_for_me",
]);

function projectPath(template: string, project: string): string {
  return template.replace(":project", project);
}

export const GITLAB_HANDLERS: Readonly<Record<string, GitlabOperationHandler>> =
  Object.freeze({
    "connection.get": () => ({ path: "/user", query: {} }),

    "projects.list": (input) => {
      const archived = optionalBoolean(input["archived"], "archived");
      return {
        path: "/projects",
        query: withPagination(
          {
            search: optionalText(input["search"], "search", 1, 200),
            // GitLab only accepts the string "true" for this flag.
            membership:
              optionalBoolean(input["membership"], "membership") === true
                ? "true"
                : undefined,
            archived: archived === undefined ? undefined : String(archived),
            order_by: optionalText(input["orderBy"], "orderBy", 2, 32),
            sort: optionalText(input["sort"], "sort", 3, 4),
          },
          input,
          LIST_MAX_PER_PAGE,
        ),
      };
    },

    "projects.get": (input) => ({
      path: projectPath("/projects/:project", projectRef(input["project"])),
      query: {},
    }),

    "repository.tree": (input) => ({
      path: projectPath(
        "/projects/:project/repository/tree",
        projectRef(input["project"]),
      ),
      query: withPagination(
        {
          path: optionalText(input["path"], "path", 1, 512),
          ref: input["ref"] === undefined ? undefined : refName(input["ref"]),
          // Recursion is allowed but stays paged: the model walks the tree
          // instead of asking for a whole repository in one call.
          recursive:
            optionalBoolean(input["recursive"], "recursive") === true
              ? "true"
              : undefined,
        },
        input,
        LIST_MAX_PER_PAGE,
      ),
    }),

    "repository.file": (input) => ({
      path: projectPath(
        `/projects/:project/repository/files/${filePath(input["path"])}`,
        projectRef(input["project"]),
      ),
      // HEAD makes GitLab resolve the project's default branch itself.
      query: {
        ref: input["ref"] === undefined ? "HEAD" : refName(input["ref"]),
      },
    }),

    "repository.commits": (input) => ({
      path: projectPath(
        "/projects/:project/repository/commits",
        projectRef(input["project"]),
      ),
      query: withPagination(
        {
          ref_name:
            input["ref"] === undefined ? undefined : refName(input["ref"]),
          path: optionalText(input["path"], "path", 1, 512),
          since: optionalTimestamp(input["since"], "since"),
          until: optionalTimestamp(input["until"], "until"),
          author: optionalText(input["author"], "author", 1, 120),
        },
        input,
        LIST_MAX_PER_PAGE,
      ),
    }),

    "repository.commit": (input) => ({
      path: projectPath(
        `/projects/:project/repository/commits/${commitSha(input["sha"])}`,
        projectRef(input["project"]),
      ),
      query: {
        stats:
          optionalBoolean(input["stats"], "stats") === false
            ? undefined
            : "true",
      },
    }),

    "repository.compare": (input) => ({
      path: projectPath(
        "/projects/:project/repository/compare",
        projectRef(input["project"]),
      ),
      query: {
        from: refName(input["from"], "from"),
        to: refName(input["to"], "to"),
        unidiff:
          optionalBoolean(input["unidiff"], "unidiff") === true
            ? "true"
            : undefined,
      },
    }),

    "search.run": (input, context) => {
      const scope = requiredText(input["scope"], "scope", 3, 32);
      if (!SEARCH_SCOPES.includes(scope)) invalid("scope");
      const project = input["project"];
      const group = input["group"];
      if (project !== undefined && group !== undefined) {
        throw new IntegrationError(
          "InvalidRequest",
          "search takes either project or group, not both",
        );
      }
      const path =
        project !== undefined
          ? projectPath("/projects/:project/search", projectRef(project))
          : group !== undefined
            ? `/groups/${groupRef(group)}/search`
            : "/search";
      if (scope === "blobs" && project === undefined && group === undefined) {
        throw new IntegrationError(
          "InvalidRequest",
          "code search needs a project or a group",
        );
      }
      return {
        path,
        query: withPagination(
          {
            scope,
            search: requiredText(input["query"], "query", 1, 200),
            ref: input["ref"] === undefined ? undefined : refName(input["ref"]),
          },
          input,
          // Search is the one caller that can drown an answer in one call, so its
          // page size is capped by the deployment switch, not only by GitLab.
          Math.min(LIST_MAX_PER_PAGE, context.flags.maxSearchResults),
        ),
      };
    },

    "issues.list": (input) => {
      const project = input["project"];
      const scope = optionalText(input["scope"], "scope", 2, 32);
      if (scope !== undefined && !ISSUE_SCOPES.includes(scope))
        invalid("scope");
      return {
        path:
          project === undefined
            ? "/issues"
            : projectPath("/projects/:project/issues", projectRef(project)),
        query: withPagination(
          {
            state: optionalText(input["state"], "state", 3, 10),
            // The global list defaults to "created by me", which hides the very
            // issues a work question is about; the whole surface is "what this
            // token may see" anyway.
            scope: scope ?? (project === undefined ? "all" : undefined),
            assignee_username: optionalText(
              input["assigneeUsername"],
              "assigneeUsername",
              1,
              120,
            ),
            author_username: optionalText(
              input["authorUsername"],
              "authorUsername",
              1,
              120,
            ),
            labels: optionalLabels(input["labels"]),
            milestone: optionalText(input["milestone"], "milestone", 1, 120),
            search: optionalText(input["search"], "search", 1, 200),
            updated_after: optionalTimestamp(
              input["updatedAfter"],
              "updatedAfter",
            ),
            updated_before: optionalTimestamp(
              input["updatedBefore"],
              "updatedBefore",
            ),
          },
          input,
          LIST_MAX_PER_PAGE,
        ),
      };
    },

    "issues.get": (input) => ({
      path: projectPath(
        `/projects/:project/issues/${requiredIid(input["iid"], "iid")}`,
        projectRef(input["project"]),
      ),
      query: {},
    }),

    "issues.notes": (input) => ({
      path: projectPath(
        `/projects/:project/issues/${requiredIid(input["iid"], "iid")}/notes`,
        projectRef(input["project"]),
      ),
      query: withPagination(
        { sort: optionalText(input["sort"], "sort", 3, 4) },
        input,
        LIST_MAX_PER_PAGE,
      ),
    }),

    "mergeRequests.list": (input) => {
      const project = input["project"];
      const scope = optionalText(input["scope"], "scope", 2, 32);
      if (scope !== undefined && !MR_SCOPES.includes(scope)) invalid("scope");
      return {
        path:
          project === undefined
            ? "/merge_requests"
            : projectPath(
                "/projects/:project/merge_requests",
                projectRef(project),
              ),
        query: withPagination(
          {
            state: optionalText(input["state"], "state", 3, 10),
            // As with issues: "created by me" is GitLab's default and almost
            // never the question being asked.
            scope: scope ?? (project === undefined ? "all" : undefined),
            source_branch: optionalText(
              input["sourceBranch"],
              "sourceBranch",
              1,
              255,
            ),
            target_branch: optionalText(
              input["targetBranch"],
              "targetBranch",
              1,
              255,
            ),
            author_username: optionalText(
              input["authorUsername"],
              "authorUsername",
              1,
              120,
            ),
            assignee_username: optionalText(
              input["assigneeUsername"],
              "assigneeUsername",
              1,
              120,
            ),
            reviewer_username: optionalText(
              input["reviewerUsername"],
              "reviewerUsername",
              1,
              120,
            ),
            labels: optionalLabels(input["labels"]),
            search: optionalText(input["search"], "search", 1, 200),
            draft: optionalBoolean(input["draft"], "draft"),
            updated_after: optionalTimestamp(
              input["updatedAfter"],
              "updatedAfter",
            ),
            updated_before: optionalTimestamp(
              input["updatedBefore"],
              "updatedBefore",
            ),
          },
          input,
          LIST_MAX_PER_PAGE,
        ),
      };
    },

    "mergeRequests.get": (input) => ({
      path: projectPath(
        `/projects/:project/merge_requests/${requiredIid(input["iid"], "iid")}`,
        projectRef(input["project"]),
      ),
      query: {},
    }),

    "mergeRequests.changes": (input) => ({
      path: projectPath(
        `/projects/:project/merge_requests/${requiredIid(input["iid"], "iid")}/diffs`,
        projectRef(input["project"]),
      ),
      query: withPagination(
        {
          unidiff:
            optionalBoolean(input["unidiff"], "unidiff") === true
              ? "true"
              : undefined,
        },
        input,
        LIST_MAX_PER_PAGE,
      ),
    }),

    "mergeRequests.discussions": (input) => ({
      path: projectPath(
        `/projects/:project/merge_requests/${requiredIid(input["iid"], "iid")}/discussions`,
        projectRef(input["project"]),
      ),
      query: withPagination({}, input, LIST_MAX_PER_PAGE),
    }),

    "mergeRequests.approvals": (input) => ({
      path: projectPath(
        `/projects/:project/merge_requests/${requiredIid(input["iid"], "iid")}/approvals`,
        projectRef(input["project"]),
      ),
      query: {},
    }),

    "mergeRequests.pipelines": (input) => ({
      path: projectPath(
        `/projects/:project/merge_requests/${requiredIid(input["iid"], "iid")}/pipelines`,
        projectRef(input["project"]),
      ),
      query: withPagination({}, input, LIST_MAX_PER_PAGE),
    }),

    "pipelines.list": (input) => ({
      path: projectPath(
        "/projects/:project/pipelines",
        projectRef(input["project"]),
      ),
      query: withPagination(
        {
          ref: input["ref"] === undefined ? undefined : refName(input["ref"]),
          status: optionalText(input["status"], "status", 3, 32),
          source: optionalText(input["source"], "source", 3, 32),
          username: optionalText(input["username"], "username", 1, 120),
          updated_after: optionalTimestamp(
            input["updatedAfter"],
            "updatedAfter",
          ),
          updated_before: optionalTimestamp(
            input["updatedBefore"],
            "updatedBefore",
          ),
        },
        input,
        LIST_MAX_PER_PAGE,
      ),
    }),

    "pipelines.get": (input) => ({
      path: projectPath(
        `/projects/:project/pipelines/${requiredInteger(input["pipelineId"], "pipelineId")}`,
        projectRef(input["project"]),
      ),
      query: {},
    }),

    "pipelines.jobs": (input) => ({
      path: projectPath(
        `/projects/:project/pipelines/${requiredInteger(input["pipelineId"], "pipelineId")}/jobs`,
        projectRef(input["project"]),
      ),
      query: withPagination(
        {
          // GitLab takes repeated `scope[]` values; one status is enough for a
          // readable answer and keeps the query bounded.
          "scope[]":
            input["status"] === undefined
              ? undefined
              : requiredText(input["status"], "status", 3, 32),
          include_retried:
            optionalBoolean(input["includeRetried"], "includeRetried") === true
              ? "true"
              : undefined,
        },
        input,
        LIST_MAX_PER_PAGE,
      ),
    }),

    "jobs.get": (input) => ({
      path: projectPath(
        `/projects/:project/jobs/${requiredInteger(input["jobId"], "jobId")}`,
        projectRef(input["project"]),
      ),
      query: {},
    }),

    "jobs.log": (input) => ({
      path: projectPath(
        `/projects/:project/jobs/${requiredInteger(input["jobId"], "jobId")}/trace`,
        projectRef(input["project"]),
      ),
      query: {},
    }),
  });

/* ------------------------------------------------------------------ */
/* Response shaping                                                    */
/* ------------------------------------------------------------------ */

function userSummary(value: unknown): Record<string, unknown> | undefined {
  const source = recordOf(value);
  const id = numberOf(source, "id");
  if (id === undefined) return undefined;
  return compact({
    id,
    username: stringOf(source, "username"),
    name: stringOf(source, "name"),
    webUrl: stringOf(source, "web_url"),
  });
}

function userSummaries(
  source: Record<string, unknown>,
  key: string,
): unknown[] {
  return arrayOf(source, key)
    .map((item) => userSummary(item))
    .filter((item) => item !== undefined);
}

function projectSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: numberOf(source, "id"),
    pathWithNamespace: stringOf(source, "path_with_namespace"),
    name: stringOf(source, "name"),
    description: stringOf(source, "description"),
    defaultBranch: stringOf(source, "default_branch"),
    archived: booleanOf(source, "archived"),
    visibility: stringOf(source, "visibility"),
    webUrl: stringOf(source, "web_url"),
    lastActivityAt: stringOf(source, "last_activity_at"),
  });
}

function issueSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    projectId: numberOf(source, "project_id"),
    iid: numberOf(source, "iid"),
    title: stringOf(source, "title"),
    state: stringOf(source, "state"),
    confidential: booleanOf(source, "confidential"),
    labels: arrayOf(source, "labels"),
    author: userSummary(source["author"]),
    assignees: userSummaries(source, "assignees"),
    webUrl: stringOf(source, "web_url"),
    createdAt: stringOf(source, "created_at"),
    updatedAt: stringOf(source, "updated_at"),
  });
}

function mergeRequestSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    projectId: numberOf(source, "project_id"),
    iid: numberOf(source, "iid"),
    title: stringOf(source, "title"),
    state: stringOf(source, "state"),
    draft: booleanOf(source, "draft"),
    sourceBranch: stringOf(source, "source_branch"),
    targetBranch: stringOf(source, "target_branch"),
    author: userSummary(source["author"]),
    assignees: userSummaries(source, "assignees"),
    reviewers: userSummaries(source, "reviewers"),
    webUrl: stringOf(source, "web_url"),
    createdAt: stringOf(source, "created_at"),
    updatedAt: stringOf(source, "updated_at"),
  });
}

function pipelineSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: numberOf(source, "id"),
    iid: numberOf(source, "iid"),
    projectId: numberOf(source, "project_id"),
    status: stringOf(source, "status"),
    source: stringOf(source, "source"),
    ref: stringOf(source, "ref"),
    sha: stringOf(source, "sha"),
    webUrl: stringOf(source, "web_url"),
    createdAt: stringOf(source, "created_at"),
    updatedAt: stringOf(source, "updated_at"),
    username: stringOf(source, "username"),
  });
}

function jobSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: numberOf(source, "id"),
    name: stringOf(source, "name"),
    stage: stringOf(source, "stage"),
    status: stringOf(source, "status"),
    ref: stringOf(source, "ref"),
    allowFailure: booleanOf(source, "allow_failure"),
    failureReason: stringOf(source, "failure_reason"),
    duration: numberOf(source, "duration"),
    queuedDuration: numberOf(source, "queued_duration"),
    createdAt: stringOf(source, "created_at"),
    startedAt: stringOf(source, "started_at"),
    finishedAt: stringOf(source, "finished_at"),
    webUrl: stringOf(source, "web_url"),
    user: userSummary(source["user"]),
  });
}

function commitSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    shortId: stringOf(source, "short_id"),
    title: stringOf(source, "title"),
    authorName: stringOf(source, "author_name"),
    authoredDate: stringOf(source, "authored_date"),
    committerName: stringOf(source, "committer_name"),
    webUrl: stringOf(source, "web_url"),
  });
}

/**
 * One file of a diff. The diff text is what makes a comparison useful and what
 * makes it enormous, so callers spend a shared character budget on it and keep
 * every path even after the budget runs out.
 */
function diffEntry(
  value: unknown,
  budget: { left: number },
): Record<string, unknown> {
  const source = recordOf(value);
  const diff = stringOf(source, "diff");
  const partial = diff !== undefined && diff.length > budget.left;
  const kept = diff === undefined ? undefined : diff.slice(0, budget.left);
  budget.left -= kept?.length ?? 0;
  return compact({
    oldPath: stringOf(source, "old_path"),
    newPath: stringOf(source, "new_path"),
    newFile: booleanOf(source, "new_file"),
    renamedFile: booleanOf(source, "renamed_file"),
    deletedFile: booleanOf(source, "deleted_file"),
    tooLarge: booleanOf(source, "too_large"),
    collapsed: booleanOf(source, "collapsed"),
    diff: kept,
    diffTruncated: partial ? true : undefined,
  });
}

function diffsWithin(
  values: unknown[],
  maxChars: number,
): { items: unknown[]; truncated: boolean } {
  const budget = { left: maxChars };
  const items = values.map((value) => diffEntry(value, budget));
  return {
    items,
    truncated: items.some((item) => item["diffTruncated"] === true),
  };
}

function noteSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: numberOf(source, "id"),
    body: stringOf(source, "body"),
    author: userSummary(source["author"]),
    system: booleanOf(source, "system"),
    internal: booleanOf(source, "internal"),
    resolvable: booleanOf(source, "resolvable"),
    resolved: booleanOf(source, "resolved"),
    createdAt: stringOf(source, "created_at"),
    updatedAt: stringOf(source, "updated_at"),
  });
}

function projectDetail(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const namespace = recordOf(source["namespace"]);
  return compact({
    ...projectSummary(source),
    topics: arrayOf(source, "topics"),
    createdAt: stringOf(source, "created_at"),
    namespace: compact({
      id: numberOf(namespace, "id"),
      fullPath: stringOf(namespace, "full_path"),
      kind: stringOf(namespace, "kind"),
    }),
  });
}

function issueDetail(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const milestone = recordOf(source["milestone"]);
  return compact({
    ...issueSummary(source),
    description: stringOf(source, "description"),
    milestone: compact({
      id: numberOf(milestone, "id"),
      title: stringOf(milestone, "title"),
    }),
    dueDate: stringOf(source, "due_date"),
    closedAt: stringOf(source, "closed_at"),
    closedBy: userSummary(source["closed_by"]),
    userNotesCount: numberOf(source, "user_notes_count"),
    reference:
      stringOf(source, "references") === undefined
        ? undefined
        : stringOf(recordOf(source["references"]), "full"),
  });
}

function mergeRequestDetail(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const milestone = recordOf(source["milestone"]);
  return compact({
    ...mergeRequestSummary(source),
    description: stringOf(source, "description"),
    mergeStatus: stringOf(source, "merge_status"),
    detailedMergeStatus: stringOf(source, "detailed_merge_status"),
    hasConflicts: booleanOf(source, "has_conflicts"),
    blockingDiscussionsResolved: booleanOf(
      source,
      "blocking_discussions_resolved",
    ),
    labels: arrayOf(source, "labels"),
    milestone: compact({
      id: numberOf(milestone, "id"),
      title: stringOf(milestone, "title"),
    }),
    userNotesCount: numberOf(source, "user_notes_count"),
    sha: stringOf(source, "sha"),
    sourceProjectId: numberOf(source, "source_project_id"),
    targetProjectId: numberOf(source, "target_project_id"),
    reference: stringOf(recordOf(source["references"]), "full"),
  });
}

export interface GitlabProjectionContext {
  readonly flags: GitlabFlags;
  /** Body budget for the operations that hand a file or a log to the model. */
  readonly byteLimit?: number | undefined;
}

export type GitlabProjection = (
  data: unknown,
  context: GitlabProjectionContext,
) => unknown;

/** Character budget for the diff text of one comparison or change listing. */
const DIFF_BUDGET = 200_000;

export const GITLAB_PROJECTIONS: Readonly<Record<string, GitlabProjection>> =
  Object.freeze({
    "connection.get": (data) => {
      const source = recordOf(data);
      return compact({
        id: numberOf(source, "id"),
        username: stringOf(source, "username"),
        name: stringOf(source, "name"),
        state: stringOf(source, "state"),
        webUrl: stringOf(source, "web_url"),
      });
    },
    "projects.list": (data) =>
      (Array.isArray(data) ? data : []).map(projectSummary),
    "projects.get": projectDetail,
    "repository.tree": (data) =>
      (Array.isArray(data) ? data : []).map((item) => {
        const source = recordOf(item);
        return compact({
          id: stringOf(source, "id"),
          name: stringOf(source, "name"),
          type: stringOf(source, "type"),
          path: stringOf(source, "path"),
          mode: stringOf(source, "mode"),
        });
      }),
    "repository.file": (data, context) => {
      const source = recordOf(data);
      const encoding = stringOf(source, "encoding") ?? "base64";
      const raw = stringOf(source, "content") ?? "";
      const bytes = Buffer.from(raw, encoding === "base64" ? "base64" : "utf8");
      // The answer carries no content type, so the shared verdict rests on the
      // bytes alone — exactly what this provider needs here.
      const binary = looksBinary(null, bytes);
      // The body is what makes a file read useful and what makes it huge: keep
      // a bounded prefix and say so rather than dropping the answer entirely.
      const limit = context.byteLimit ?? bytes.byteLength;
      const truncated = !binary && bytes.byteLength > limit;
      return compact({
        fileName: stringOf(source, "file_name"),
        filePath: stringOf(source, "file_path"),
        ref: stringOf(source, "ref"),
        size: numberOf(source, "size"),
        encoding,
        blobId: stringOf(source, "blob_id"),
        lastCommitId: stringOf(source, "last_commit_id"),
        binary: binary ? true : undefined,
        truncated: truncated ? true : undefined,
        content: binary ? undefined : bytes.subarray(0, limit).toString("utf8"),
      });
    },
    "repository.commits": (data) =>
      (Array.isArray(data) ? data : []).map(commitSummary),
    "repository.commit": (data) => {
      const source = recordOf(data);
      const stats = recordOf(source["stats"]);
      return compact({
        id: stringOf(source, "id"),
        shortId: stringOf(source, "short_id"),
        title: stringOf(source, "title"),
        message: stringOf(source, "message"),
        authorName: stringOf(source, "author_name"),
        authorEmail: stringOf(source, "author_email"),
        authoredDate: stringOf(source, "authored_date"),
        committerName: stringOf(source, "committer_name"),
        committedDate: stringOf(source, "committed_date"),
        parentIds: arrayOf(source, "parent_ids"),
        webUrl: stringOf(source, "web_url"),
        stats: compact({
          additions: numberOf(stats, "additions"),
          deletions: numberOf(stats, "deletions"),
          total: numberOf(stats, "total"),
        }),
      });
    },
    "repository.compare": (data) => {
      const source = recordOf(data);
      const diffs = diffsWithin(arrayOf(source, "diffs"), DIFF_BUDGET);
      return compact({
        commit: commitSummary(source["commit"]),
        commits: arrayOf(source, "commits").map(commitSummary),
        diffs: diffs.items,
        diffTruncated: diffs.truncated ? true : undefined,
      });
    },
    "search.run": (data) =>
      (Array.isArray(data) ? data : []).map((item) => {
        const source = recordOf(item);
        return compact({
          // Search answers differ per scope, so both shapes are projected onto
          // one object with the fields a follow-up call needs.
          id: numberOf(source, "id"),
          iid: numberOf(source, "iid"),
          projectId: numberOf(source, "project_id"),
          title: stringOf(source, "title"),
          name: stringOf(source, "name"),
          path: stringOf(source, "path"),
          filename: stringOf(source, "filename"),
          ref: stringOf(source, "ref"),
          startline: numberOf(source, "startline"),
          data: stringOf(source, "data"),
          webUrl: stringOf(source, "web_url"),
          snippet: stringOf(source, "snippet"),
        });
      }),
    "issues.list": (data) =>
      (Array.isArray(data) ? data : []).map(issueSummary),
    "issues.get": issueDetail,
    "issues.notes": (data) =>
      (Array.isArray(data) ? data : []).map(noteSummary),
    "mergeRequests.list": (data) =>
      (Array.isArray(data) ? data : []).map(mergeRequestSummary),
    "mergeRequests.get": mergeRequestDetail,
    "mergeRequests.changes": (data) => {
      const diffs = diffsWithin(Array.isArray(data) ? data : [], DIFF_BUDGET);
      return compact({
        items: diffs.items,
        diffTruncated: diffs.truncated ? true : undefined,
      });
    },
    "mergeRequests.discussions": (data) =>
      (Array.isArray(data) ? data : []).map((item) => {
        const source = recordOf(item);
        return compact({
          id: stringOf(source, "id"),
          individualNote: booleanOf(source, "individual_note"),
          resolved: booleanOf(source, "resolved"),
          notes: arrayOf(source, "notes").map(noteSummary),
        });
      }),
    "mergeRequests.approvals": (data) => {
      const source = recordOf(data);
      return compact({
        approved: booleanOf(source, "approved"),
        approvalsRequired: numberOf(source, "approvals_required"),
        approvalsLeft: numberOf(source, "approvals_left"),
        userHasApproved: booleanOf(source, "user_has_approved"),
        userCanApprove: booleanOf(source, "user_can_approve"),
        approvedBy: arrayOf(source, "approved_by")
          .map((item) => userSummary(recordOf(item)["user"]))
          .filter((item) => item !== undefined),
      });
    },
    "mergeRequests.pipelines": (data) =>
      (Array.isArray(data) ? data : []).map(pipelineSummary),
    "pipelines.list": (data) =>
      (Array.isArray(data) ? data : []).map(pipelineSummary),
    "pipelines.get": (data) => {
      const source = recordOf(data);
      return compact({
        ...pipelineSummary(source),
        duration: numberOf(source, "duration"),
        queuedDuration: numberOf(source, "queued_duration"),
        startedAt: stringOf(source, "started_at"),
        finishedAt: stringOf(source, "finished_at"),
        coverage: stringOf(source, "coverage"),
        detailedStatus:
          stringOf(source, "detailed_status") === undefined
            ? undefined
            : stringOf(recordOf(source["detailed_status"]), "label"),
      });
    },
    "pipelines.jobs": (data) =>
      (Array.isArray(data) ? data : []).map(jobSummary),
    "jobs.get": (data) => {
      const source = recordOf(data);
      const pipeline = recordOf(source["pipeline"]);
      return compact({
        ...jobSummary(source),
        tagList: arrayOf(source, "tag_list"),
        pipelineId: numberOf(pipeline, "id"),
        artifacts: arrayOf(source, "artifacts").map((item) => {
          const artifact = recordOf(item);
          return compact({
            fileType: stringOf(artifact, "file_type"),
            filename: stringOf(artifact, "filename"),
            size: numberOf(artifact, "size"),
          });
        }),
      });
    },
  });

/** Byte size of a project's file that this deployment is willing to hand over. */
export function fileByteLimit(requested: unknown, flags: GitlabFlags): number {
  const asked = optionalInteger(requested, "maxBytes", 1_024, 4_194_304);
  return Math.min(asked ?? flags.maxFileBytes, flags.maxFileBytes);
}

/** Byte size of a job log this deployment is willing to hand over. */
export function jobLogByteLimit(
  requested: unknown,
  flags: GitlabFlags,
): number {
  const asked = optionalInteger(requested, "maxBytes", 1_024, 4_194_304);
  return Math.min(asked ?? flags.maxJobLogBytes, flags.maxJobLogBytes);
}
