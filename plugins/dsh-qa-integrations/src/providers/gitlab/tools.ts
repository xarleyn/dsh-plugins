import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import {
  optionalBoolean,
  optionalInteger,
  requiredInteger,
  requiredStringList,
  requiredText,
} from "../../coerce.js";
import type { IntegrationBroker } from "../../broker.js";
import type { IntegrationPrincipal } from "../../types.js";
import { createToolKit } from "../../tool-kit.js";
import { ISSUE_SCOPES, MR_SCOPES, SEARCH_SCOPES } from "./operations.js";

export const GITLAB_TOOL_NAMES = [
  "gitlab_connection_get",
  "gitlab_projects_list",
  "gitlab_project_get",
  "gitlab_repository_tree",
  "gitlab_repository_file_get",
  "gitlab_commits_list",
  "gitlab_commit_get",
  "gitlab_compare",
  "gitlab_search",
  "gitlab_issues_list",
  "gitlab_issue_get",
  "gitlab_issue_notes_list",
  "gitlab_merge_requests_list",
  "gitlab_merge_request_get",
  "gitlab_merge_request_changes_get",
  "gitlab_merge_request_discussions_list",
  "gitlab_merge_request_approvals_get",
  "gitlab_merge_request_pipelines_list",
  "gitlab_pipelines_list",
  "gitlab_pipeline_get",
  "gitlab_pipeline_jobs_list",
  "gitlab_job_get",
  "gitlab_job_log_get",
] as const;

const PROJECT_HINT =
  "Project id (number) or full path such as group/subgroup/project. Both work; the id is what the operation is audited against.";

const GROUP_HINT = "Group id or full path, such as group/subgroup.";

/** GitLab accepts either the numeric id or the path, so both are offered. */
const REQUIRED_PROJECT = {
  oneOf: [{ type: "string" }, { type: "number" }],
  required: true,
  description: PROJECT_HINT,
} as const;

const PROJECT = {
  oneOf: [{ type: "string" }, { type: "number" }],
  description: PROJECT_HINT,
} as const;

const GROUP = {
  oneOf: [{ type: "string" }, { type: "number" }],
  description: GROUP_HINT,
} as const;

const REF_HINT =
  "Branch, tag or commit sha. Defaults to the project's default branch where GitLab allows it.";

const PAGE_HINT =
  "Pagination: GitLab returns 20 rows per page by default and at most 100; the answer carries `pagination.nextPage` while more rows exist.";

const STATE_HINT = 'State filter: "opened", "closed" or "all".';

const IID_HINT =
  "Internal id of the resource inside the project (the number shown as #123), not the global id.";

const TIMESTAMP_HINT =
  "ISO 8601 timestamp, or a plain date (YYYY-MM-DD) for midnight UTC.";

const LABELS_HINT = "Label names; several are ANDed, as GitLab does.";

const SORT_HINT = 'Sort direction: "asc" or "desc".';

/**
 * Every tool reports what the *connected* GitLab account may read, never a
 * caller-supplied identity: the account comes from the stored integration of
 * the QA user who owns the DSH session, and the tool schemas carry no user,
 * credential or instance selector.
 */
export function createGitlabTools(options: {
  readonly broker: IntegrationBroker;
  readonly principalForSession: (
    sessionId: string,
  ) => IntegrationPrincipal | undefined;
}): readonly ToolDefinition[] {
  const kit = createToolKit({ ...options, provider: "gitlab" });
  const tool = kit.tool;

  return [
    tool({
      name: "gitlab_connection_get",
      description:
        "Which GitLab instance and user the integration is connected as. Read-only; returns the instance address, the GitLab login and profile name. No token is ever returned.",
      parameters: {},
      operation: "connection.get",
      input: () => ({}),
    }),

    tool({
      name: "gitlab_projects_list",
      description:
        "Search projects visible to the connected GitLab account. Read-only; returns compact project cards (path, default branch, visibility), use gitlab_project_get for one project in full.",
      parameters: {
        search: {
          type: "string",
          description:
            "Case-insensitive substring of the project name or path.",
        },
        membership: {
          type: "boolean",
          description: "Only projects the connected account is a member of.",
        },
        archived: {
          type: "boolean",
          description:
            "true returns archived projects only, false hides them. Omit for both.",
        },
        orderBy: {
          type: "string",
          enum: ["id", "name", "path", "created_at", "last_activity_at"],
          description: "Sort field. Defaults to GitLab's own ordering.",
        },
        sort: { type: "string", enum: ["asc", "desc"], description: SORT_HINT },
        page: { type: "number", description: PAGE_HINT },
        perPage: { type: "number", description: "Rows per page, at most 100." },
      },
      operation: "projects.list",
      input: (args) => ({
        ...(args["search"] === undefined
          ? {}
          : { search: requiredText(args["search"], "search", 1, 200) }),
        ...(args["membership"] === undefined
          ? {}
          : { membership: optionalBoolean(args["membership"], "membership") }),
        ...(args["archived"] === undefined
          ? {}
          : { archived: optionalBoolean(args["archived"], "archived") }),
        ...(args["orderBy"] === undefined
          ? {}
          : { orderBy: requiredText(args["orderBy"], "orderBy", 2, 32) }),
        ...(args["sort"] === undefined
          ? {}
          : { sort: requiredText(args["sort"], "sort", 3, 4) }),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_project_get",
      description:
        "One project in full: description, default branch, visibility, namespace and timestamps. Read-only.",
      parameters: {
        project: REQUIRED_PROJECT,
      },
      operation: "projects.get",
      input: (args) => ({ project: args["project"] }),
    }),

    tool({
      name: "gitlab_repository_tree",
      description:
        "List files and directories of a project at a ref, one directory level at a time. Read-only; a recursive listing is paged, so walk the tree instead of asking for a whole repository.",
      parameters: {
        project: REQUIRED_PROJECT,
        path: {
          type: "string",
          description:
            "Directory path inside the repository. Omit for the root.",
        },
        ref: { type: "string", description: REF_HINT },
        recursive: {
          type: "boolean",
          description:
            "List every descendant of `path`. Still paged; prefer walking.",
        },
        page: { type: "number", description: PAGE_HINT },
        perPage: { type: "number", description: "Rows per page, at most 100." },
      },
      operation: "repository.tree",
      input: (args) => ({
        project: args["project"],
        ...(args["path"] === undefined
          ? {}
          : { path: requiredText(args["path"], "path", 1, 512) }),
        ...(args["ref"] === undefined
          ? {}
          : { ref: requiredText(args["ref"], "ref", 1, 255) }),
        ...(args["recursive"] === undefined
          ? {}
          : { recursive: optionalBoolean(args["recursive"], "recursive") }),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_repository_file_get",
      description:
        "Read one text file of a repository, with its size and blob id. Read-only. Binary files and files above the deployment limit answer with metadata only (`binary` or `truncated`), never with raw bytes.",
      parameters: {
        project: REQUIRED_PROJECT,
        path: {
          type: "string",
          required: true,
          description: "Full file path inside the repository.",
        },
        ref: { type: "string", description: REF_HINT },
        maxBytes: {
          type: "number",
          description:
            "Byte budget for the returned body; capped by the deployment limit.",
        },
      },
      operation: "repository.file",
      input: (args) => ({
        project: args["project"],
        path: requiredText(args["path"], "path", 1, 512),
        ...(args["ref"] === undefined
          ? {}
          : { ref: requiredText(args["ref"], "ref", 1, 255) }),
        ...(args["maxBytes"] === undefined
          ? {}
          : { maxBytes: optionalInteger(args["maxBytes"], "maxBytes", 1_024) }),
      }),
    }),

    tool({
      name: "gitlab_commits_list",
      description:
        "Commits of a project, optionally of one ref or one file path. Read-only; returns the compact card (short id, title, author, date).",
      parameters: {
        project: REQUIRED_PROJECT,
        ref: { type: "string", description: REF_HINT },
        path: {
          type: "string",
          description: "Only commits that changed this file.",
        },
        since: {
          type: "string",
          description: `Commits after this time. ${TIMESTAMP_HINT}`,
        },
        until: {
          type: "string",
          description: `Commits before this time. ${TIMESTAMP_HINT}`,
        },
        author: {
          type: "string",
          description: "Author name or e-mail, as GitLab matches it.",
        },
        page: { type: "number", description: PAGE_HINT },
        perPage: { type: "number", description: "Rows per page, at most 100." },
      },
      operation: "repository.commits",
      input: (args) => ({
        project: args["project"],
        ...(args["ref"] === undefined
          ? {}
          : { ref: requiredText(args["ref"], "ref", 1, 255) }),
        ...(args["path"] === undefined
          ? {}
          : { path: requiredText(args["path"], "path", 1, 512) }),
        ...(args["since"] === undefined
          ? {}
          : { since: requiredText(args["since"], "since", 10, 40) }),
        ...(args["until"] === undefined
          ? {}
          : { until: requiredText(args["until"], "until", 10, 40) }),
        ...(args["author"] === undefined
          ? {}
          : { author: requiredText(args["author"], "author", 1, 120) }),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_commit_get",
      description:
        "One commit: full message, author and committer, parents and the diff line counts. Read-only; use gitlab_compare for the diff itself.",
      parameters: {
        project: REQUIRED_PROJECT,
        sha: {
          type: "string",
          required: true,
          description: "Commit sha, full or short (at least 7 characters).",
        },
        stats: {
          type: "boolean",
          description: "Include additions/deletions (on by default).",
        },
      },
      operation: "repository.commit",
      input: (args) => ({
        project: args["project"],
        sha: requiredText(args["sha"], "sha", 7, 40),
        ...(args["stats"] === undefined
          ? {}
          : { stats: optionalBoolean(args["stats"], "stats") }),
      }),
    }),

    tool({
      name: "gitlab_compare",
      description:
        "Compare two refs or commits of one project: the commits between them and the changed files. Read-only; diff bodies are capped and the answer says so with `diffTruncated`.",
      parameters: {
        project: REQUIRED_PROJECT,
        from: {
          type: "string",
          required: true,
          description: "Base ref or commit sha.",
        },
        to: {
          type: "string",
          required: true,
          description: "Head ref or commit sha.",
        },
        unidiff: {
          type: "boolean",
          description:
            "Return diff bodies in unified format, with [--] markers instead of a bare hunk dump.",
        },
      },
      operation: "repository.compare",
      input: (args) => ({
        project: args["project"],
        from: requiredText(args["from"], "from", 1, 255),
        to: requiredText(args["to"], "to", 1, 255),
        ...(args["unidiff"] === undefined
          ? {}
          : { unidiff: optionalBoolean(args["unidiff"], "unidiff") }),
      }),
    }),

    tool({
      name: "gitlab_search",
      description:
        "Search across GitLab as the connected account. Read-only. Code search (`blobs`) needs a project or a group: GitLab only offers it scope-locally. Results are capped by the deployment limit.",
      parameters: {
        query: { type: "string", required: true, description: "Search text." },
        scope: {
          type: "string",
          required: true,
          enum: [...SEARCH_SCOPES],
          description:
            "What to search. `blobs` is code search, `notes` searches comments.",
        },
        project: PROJECT,
        group: GROUP,
        ref: {
          type: "string",
          description:
            "Ref to search in, only meaningful together with a project.",
        },
        page: { type: "number", description: PAGE_HINT },
        perPage: {
          type: "number",
          description: "Rows per page, capped by the deployment search limit.",
        },
      },
      operation: "search.run",
      input: (args) => ({
        query: requiredText(args["query"], "query", 1, 200),
        scope: requiredText(args["scope"], "scope", 3, 32),
        ...(args["project"] === undefined ? {} : { project: args["project"] }),
        ...(args["group"] === undefined ? {} : { group: args["group"] }),
        ...(args["ref"] === undefined
          ? {}
          : { ref: requiredText(args["ref"], "ref", 1, 255) }),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_issues_list",
      description:
        "Search issues across the projects the connected account can see, or inside one project. Read-only; returns compact cards without descriptions.",
      parameters: {
        project: PROJECT,
        state: {
          type: "string",
          enum: ["opened", "closed", "all"],
          description: STATE_HINT,
        },
        scope: {
          type: "string",
          enum: [...ISSUE_SCOPES],
          description:
            "Whose issues. Not naming one returns every issue the token may read.",
        },
        assigneeUsername: { type: "string", description: "Assignee login." },
        authorUsername: { type: "string", description: "Author login." },
        labels: {
          type: "array",
          items: { type: "string" },
          description: LABELS_HINT,
        },
        milestone: { type: "string", description: "Milestone title." },
        search: {
          type: "string",
          description: "Substring of the title or description.",
        },
        updatedAfter: {
          type: "string",
          description: `Updated after. ${TIMESTAMP_HINT}`,
        },
        updatedBefore: {
          type: "string",
          description: `Updated before. ${TIMESTAMP_HINT}`,
        },
        page: { type: "number", description: PAGE_HINT },
        perPage: { type: "number", description: "Rows per page, at most 100." },
      },
      operation: "issues.list",
      input: (args) => ({
        ...(args["project"] === undefined ? {} : { project: args["project"] }),
        ...(args["state"] === undefined
          ? {}
          : { state: requiredText(args["state"], "state", 3, 10) }),
        ...(args["scope"] === undefined
          ? {}
          : { scope: requiredText(args["scope"], "scope", 2, 32) }),
        ...(args["assigneeUsername"] === undefined
          ? {}
          : {
              assigneeUsername: requiredText(
                args["assigneeUsername"],
                "assigneeUsername",
                1,
                120,
              ),
            }),
        ...(args["authorUsername"] === undefined
          ? {}
          : {
              authorUsername: requiredText(
                args["authorUsername"],
                "authorUsername",
                1,
                120,
              ),
            }),
        ...(args["labels"] === undefined
          ? {}
          : { labels: requiredStringList(args["labels"], "labels", 20, 100) }),
        ...(args["milestone"] === undefined
          ? {}
          : {
              milestone: requiredText(args["milestone"], "milestone", 1, 120),
            }),
        ...(args["search"] === undefined
          ? {}
          : { search: requiredText(args["search"], "search", 1, 200) }),
        ...(args["updatedAfter"] === undefined
          ? {}
          : {
              updatedAfter: requiredText(
                args["updatedAfter"],
                "updatedAfter",
                10,
                40,
              ),
            }),
        ...(args["updatedBefore"] === undefined
          ? {}
          : {
              updatedBefore: requiredText(
                args["updatedBefore"],
                "updatedBefore",
                10,
                40,
              ),
            }),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_issue_get",
      description:
        "One issue in full, including its description, milestone and due date. Read-only.",
      parameters: {
        project: REQUIRED_PROJECT,
        iid: { type: "number", required: true, description: IID_HINT },
      },
      operation: "issues.get",
      input: (args) => ({
        project: args["project"],
        iid: requiredInteger(args["iid"], "iid"),
      }),
    }),

    tool({
      name: "gitlab_issue_notes_list",
      description:
        "Comments of one issue, oldest or newest first. Read-only; system notes (label changes, moves) are marked as such.",
      parameters: {
        project: REQUIRED_PROJECT,
        iid: { type: "number", required: true, description: IID_HINT },
        sort: {
          type: "string",
          enum: ["asc", "desc"],
          description: `Order by creation time. ${SORT_HINT}`,
        },
        page: { type: "number", description: PAGE_HINT },
        perPage: { type: "number", description: "Rows per page, at most 100." },
      },
      operation: "issues.notes",
      input: (args) => ({
        project: args["project"],
        iid: requiredInteger(args["iid"], "iid"),
        ...(args["sort"] === undefined
          ? {}
          : { sort: requiredText(args["sort"], "sort", 3, 4) }),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_merge_requests_list",
      description:
        "Search merge requests across the projects the connected account can see, or inside one project. Read-only; returns compact cards without descriptions.",
      parameters: {
        project: PROJECT,
        state: {
          type: "string",
          enum: ["opened", "closed", "locked", "merged", "all"],
          description: 'State filter, "all" includes merged.',
        },
        scope: {
          type: "string",
          enum: [...MR_SCOPES],
          description:
            "Whose merge requests. Not naming one returns every MR the token may read.",
        },
        sourceBranch: { type: "string", description: "Source branch name." },
        targetBranch: { type: "string", description: "Target branch name." },
        authorUsername: { type: "string", description: "Author login." },
        assigneeUsername: { type: "string", description: "Assignee login." },
        reviewerUsername: { type: "string", description: "Reviewer login." },
        labels: {
          type: "array",
          items: { type: "string" },
          description: LABELS_HINT,
        },
        search: {
          type: "string",
          description: "Substring of the title or description.",
        },
        draft: {
          type: "boolean",
          description: "true returns drafts only, false hides them.",
        },
        updatedAfter: {
          type: "string",
          description: `Updated after. ${TIMESTAMP_HINT}`,
        },
        updatedBefore: {
          type: "string",
          description: `Updated before. ${TIMESTAMP_HINT}`,
        },
        page: { type: "number", description: PAGE_HINT },
        perPage: { type: "number", description: "Rows per page, at most 100." },
      },
      operation: "mergeRequests.list",
      input: (args) => ({
        ...(args["project"] === undefined ? {} : { project: args["project"] }),
        ...(args["state"] === undefined
          ? {}
          : { state: requiredText(args["state"], "state", 3, 10) }),
        ...(args["scope"] === undefined
          ? {}
          : { scope: requiredText(args["scope"], "scope", 2, 32) }),
        ...(args["sourceBranch"] === undefined
          ? {}
          : {
              sourceBranch: requiredText(
                args["sourceBranch"],
                "sourceBranch",
                1,
                255,
              ),
            }),
        ...(args["targetBranch"] === undefined
          ? {}
          : {
              targetBranch: requiredText(
                args["targetBranch"],
                "targetBranch",
                1,
                255,
              ),
            }),
        ...(args["authorUsername"] === undefined
          ? {}
          : {
              authorUsername: requiredText(
                args["authorUsername"],
                "authorUsername",
                1,
                120,
              ),
            }),
        ...(args["assigneeUsername"] === undefined
          ? {}
          : {
              assigneeUsername: requiredText(
                args["assigneeUsername"],
                "assigneeUsername",
                1,
                120,
              ),
            }),
        ...(args["reviewerUsername"] === undefined
          ? {}
          : {
              reviewerUsername: requiredText(
                args["reviewerUsername"],
                "reviewerUsername",
                1,
                120,
              ),
            }),
        ...(args["labels"] === undefined
          ? {}
          : { labels: requiredStringList(args["labels"], "labels", 20, 100) }),
        ...(args["search"] === undefined
          ? {}
          : { search: requiredText(args["search"], "search", 1, 200) }),
        ...(args["draft"] === undefined
          ? {}
          : { draft: optionalBoolean(args["draft"], "draft") }),
        ...(args["updatedAfter"] === undefined
          ? {}
          : {
              updatedAfter: requiredText(
                args["updatedAfter"],
                "updatedAfter",
                10,
                40,
              ),
            }),
        ...(args["updatedBefore"] === undefined
          ? {}
          : {
              updatedBefore: requiredText(
                args["updatedBefore"],
                "updatedBefore",
                10,
                40,
              ),
            }),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_merge_request_get",
      description:
        "One merge request in full: description, branches, reviewers, merge status and conflict flag. Read-only.",
      parameters: {
        project: REQUIRED_PROJECT,
        iid: { type: "number", required: true, description: IID_HINT },
      },
      operation: "mergeRequests.get",
      input: (args) => ({
        project: args["project"],
        iid: requiredInteger(args["iid"], "iid"),
      }),
    }),

    tool({
      name: "gitlab_merge_request_changes_get",
      description:
        "Files changed by a merge request, with their diffs. Read-only; paged, and the diff text of one answer is capped (`diffTruncated`), while every changed path is still listed.",
      parameters: {
        project: REQUIRED_PROJECT,
        iid: { type: "number", required: true, description: IID_HINT },
        unidiff: {
          type: "boolean",
          description: "Return unified diff bodies with [--] markers.",
        },
        page: { type: "number", description: PAGE_HINT },
        perPage: {
          type: "number",
          description: "Files per page, at most 100.",
        },
      },
      operation: "mergeRequests.changes",
      input: (args) => ({
        project: args["project"],
        iid: requiredInteger(args["iid"], "iid"),
        ...(args["unidiff"] === undefined
          ? {}
          : { unidiff: optionalBoolean(args["unidiff"], "unidiff") }),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_merge_request_discussions_list",
      description:
        "Review discussions of a merge request with their comments and resolution state. Read-only.",
      parameters: {
        project: REQUIRED_PROJECT,
        iid: { type: "number", required: true, description: IID_HINT },
        page: { type: "number", description: PAGE_HINT },
        perPage: { type: "number", description: "Rows per page, at most 100." },
      },
      operation: "mergeRequests.discussions",
      input: (args) => ({
        project: args["project"],
        iid: requiredInteger(args["iid"], "iid"),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_merge_request_approvals_get",
      description:
        "Approval state of a merge request: how many approvals are required, how many are left and who approved. Read-only; GitLab tiers differ, an unsupported instance answers with an explicit refusal.",
      parameters: {
        project: REQUIRED_PROJECT,
        iid: { type: "number", required: true, description: IID_HINT },
      },
      operation: "mergeRequests.approvals",
      input: (args) => ({
        project: args["project"],
        iid: requiredInteger(args["iid"], "iid"),
      }),
    }),

    tool({
      name: "gitlab_merge_request_pipelines_list",
      description:
        "Pipelines attached to a merge request. Read-only; returns compact pipeline cards, use gitlab_pipeline_get for one in full.",
      parameters: {
        project: REQUIRED_PROJECT,
        iid: { type: "number", required: true, description: IID_HINT },
        page: { type: "number", description: PAGE_HINT },
        perPage: { type: "number", description: "Rows per page, at most 100." },
      },
      operation: "mergeRequests.pipelines",
      input: (args) => ({
        project: args["project"],
        iid: requiredInteger(args["iid"], "iid"),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_pipelines_list",
      description:
        "Pipelines of a project, newest first unless GitLab orders otherwise. Read-only.",
      parameters: {
        project: REQUIRED_PROJECT,
        ref: {
          type: "string",
          description: "Only pipelines of this branch or tag.",
        },
        status: {
          type: "string",
          enum: [
            "created",
            "waiting_for_resource",
            "preparing",
            "pending",
            "running",
            "success",
            "failed",
            "canceled",
            "skipped",
            "manual",
            "scheduled",
          ],
          description: "Pipeline status filter.",
        },
        source: {
          type: "string",
          description:
            'What started the pipeline, for example "push", "merge_request_event", "web", "schedule".',
        },
        username: {
          type: "string",
          description: "Login of the user who ran it.",
        },
        updatedAfter: {
          type: "string",
          description: `Updated after. ${TIMESTAMP_HINT}`,
        },
        updatedBefore: {
          type: "string",
          description: `Updated before. ${TIMESTAMP_HINT}`,
        },
        page: { type: "number", description: PAGE_HINT },
        perPage: { type: "number", description: "Rows per page, at most 100." },
      },
      operation: "pipelines.list",
      input: (args) => ({
        project: args["project"],
        ...(args["ref"] === undefined
          ? {}
          : { ref: requiredText(args["ref"], "ref", 1, 255) }),
        ...(args["status"] === undefined
          ? {}
          : { status: requiredText(args["status"], "status", 3, 32) }),
        ...(args["source"] === undefined
          ? {}
          : { source: requiredText(args["source"], "source", 3, 32) }),
        ...(args["username"] === undefined
          ? {}
          : { username: requiredText(args["username"], "username", 1, 120) }),
        ...(args["updatedAfter"] === undefined
          ? {}
          : {
              updatedAfter: requiredText(
                args["updatedAfter"],
                "updatedAfter",
                10,
                40,
              ),
            }),
        ...(args["updatedBefore"] === undefined
          ? {}
          : {
              updatedBefore: requiredText(
                args["updatedBefore"],
                "updatedBefore",
                10,
                40,
              ),
            }),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_pipeline_get",
      description:
        "One pipeline in full: status, ref, sha, durations, coverage and the human-readable detailed status. Read-only.",
      parameters: {
        project: REQUIRED_PROJECT,
        pipelineId: {
          type: "number",
          required: true,
          description: "Pipeline id from gitlab_pipelines_list.",
        },
      },
      operation: "pipelines.get",
      input: (args) => ({
        project: args["project"],
        pipelineId: requiredInteger(args["pipelineId"], "pipelineId"),
      }),
    }),

    tool({
      name: "gitlab_pipeline_jobs_list",
      description:
        "Jobs of one pipeline with status, stage and duration. Read-only; use gitlab_job_log_get for the output of one job.",
      parameters: {
        project: REQUIRED_PROJECT,
        pipelineId: {
          type: "number",
          required: true,
          description: "Pipeline id from gitlab_pipelines_list.",
        },
        status: {
          type: "string",
          enum: [
            "created",
            "pending",
            "running",
            "success",
            "failed",
            "canceled",
            "skipped",
            "manual",
          ],
          description: "Only jobs in this status.",
        },
        includeRetried: {
          type: "boolean",
          description: "Also return jobs that were retried.",
        },
        page: { type: "number", description: PAGE_HINT },
        perPage: { type: "number", description: "Rows per page, at most 100." },
      },
      operation: "pipelines.jobs",
      input: (args) => ({
        project: args["project"],
        pipelineId: requiredInteger(args["pipelineId"], "pipelineId"),
        ...(args["status"] === undefined
          ? {}
          : { status: requiredText(args["status"], "status", 3, 32) }),
        ...(args["includeRetried"] === undefined
          ? {}
          : {
              includeRetried: optionalBoolean(
                args["includeRetried"],
                "includeRetried",
              ),
            }),
        ...(args["page"] === undefined
          ? {}
          : { page: optionalInteger(args["page"], "page", 1) }),
        ...(args["perPage"] === undefined
          ? {}
          : { perPage: optionalInteger(args["perPage"], "perPage", 1, 100) }),
      }),
    }),

    tool({
      name: "gitlab_job_get",
      description:
        "One CI job in full: status, stage, failure reason, tags, duration and the artifact file list. Read-only.",
      parameters: {
        project: REQUIRED_PROJECT,
        jobId: {
          type: "number",
          required: true,
          description: "Job id from gitlab_pipeline_jobs_list.",
        },
      },
      operation: "jobs.get",
      input: (args) => ({
        project: args["project"],
        jobId: requiredInteger(args["jobId"], "jobId"),
      }),
    }),

    tool({
      name: "gitlab_job_log_get",
      description:
        "Log of one CI job, with the byte count and a truncation marker. Read-only; the log is bounded by the deployment limit and stripped of token-shaped strings, because GitLab's own masking is a filter and not a promise.",
      parameters: {
        project: REQUIRED_PROJECT,
        jobId: {
          type: "number",
          required: true,
          description: "Job id from gitlab_pipeline_jobs_list.",
        },
        maxBytes: {
          type: "number",
          description:
            "Byte budget for the returned log; capped by the deployment limit.",
        },
      },
      operation: "jobs.log",
      input: (args) => ({
        project: args["project"],
        jobId: requiredInteger(args["jobId"], "jobId"),
        ...(args["maxBytes"] === undefined
          ? {}
          : { maxBytes: optionalInteger(args["maxBytes"], "maxBytes", 1_024) }),
      }),
    }),
  ];
}
