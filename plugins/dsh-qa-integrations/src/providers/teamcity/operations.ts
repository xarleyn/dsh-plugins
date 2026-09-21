import {
  externalUserIdFrom,
  invalid,
  optionalBoolean,
  optionalChoice,
  optionalInteger,
  optionalText,
  requiredInteger,
  requiredText,
} from "../../coerce.js";
import {
  booleanOf,
  compact,
  numberOf,
  recordOf,
  stringOf,
} from "../shared/payload.js";
import { artifactPath } from "./artifacts.js";
import type { TeamCityFlags } from "./config.js";
import {
  buildBuildLocator,
  dimension,
  nested,
  teamCityDate,
} from "./locators.js";

/**
 * Request building and response shaping for the TeamCity REST API.
 *
 * Every operation answers with a normalized object instead of TeamCity's own
 * DTO, and every list answers with the same `{ items, pagination }` envelope, so
 * the model learns one shape rather than a dozen. The operations that hand a
 * bounded window of text to the model are not shaped here: the provider
 * assembles those, where the byte budget lives.
 */

/** Hard caps per collection, from the provider specification. */
export const TEAMCITY_LIMITS = Object.freeze({
  projects: 100,
  buildConfigs: 100,
  builds: 50,
  changes: 100,
  tests: 100,
  problems: 100,
  queued: 50,
  investigations: 100,
  agents: 100,
  artifacts: 200,
});

/** Values TeamCity accepts for the dimensions this provider exposes. */
export const BUILD_STATES: readonly string[] = Object.freeze([
  "queued",
  "running",
  "finished",
]);
export const BUILD_STATUSES: readonly string[] = Object.freeze([
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "UNKNOWN",
]);
export const INVESTIGATION_STATES: readonly string[] = Object.freeze([
  "TAKEN",
  "FIXED",
  "GIVEN_UP",
  "NONE",
]);

const MAX_LIMIT = 1_000;
const ENTITY_ID = /^[A-Za-z0-9._-]{1,255}$/u;
const DETAILS_CHARS = 1_000;
const COMMENT_CHARS = 2_000;

const BUILD_FIELDS = [
  "id",
  "number",
  "status",
  "state",
  "statusText",
  "branchName",
  "personal",
  "queuedDate",
  "startDate",
  "finishDate",
  "webUrl",
  "buildType(id,name,projectId,projectName)",
  "agent(id,name)",
  "triggered(type,user(username,name))",
].join(",");

/** A TeamCity external id: project id, build configuration id, agent name. */
function entityId(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 1, 255);
  if (!ENTITY_ID.test(normalized)) invalid(field);
  return normalized;
}

function optionalEntityId(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : entityId(value, field);
}

/** A git branch name. It never reaches the URL path, only a locator value. */
function branchName(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 1, 255);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) invalid(field);
  return normalized;
}

function optionalBranch(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : branchName(value, field);
}

function optionalDateValue(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = requiredText(value, field, 8, 40);
  const formatted = teamCityDate(normalized);
  if (formatted === undefined) invalid(field);
  return formatted;
}

/**
 * The number of rows one call may ask for: the caller's wish is clamped to the
 * deployment cap rather than refused, because a model that asks for "the last
 * 500 builds" still gets a useful answer instead of an error.
 */
export function listLimit(requested: unknown, cap: number): number {
  const asked = optionalInteger(requested, "limit", 1, MAX_LIMIT);
  return Math.min(asked ?? cap, cap);
}

function buildLocator(buildId: number): string {
  return `id:${buildId}`;
}

export interface OperationContext {
  /**
   * TeamCity user id of the token owner, read from the stored integration. It
   * backs the "mine" default of the investigations tool; no operation ever
   * substitutes it for a model argument.
   */
  readonly externalUserId?: string | undefined;
  readonly flags: TeamCityFlags;
}

export interface TeamCityRequest {
  readonly path: string;
  readonly query: Readonly<Record<string, string | undefined>>;
  /**
   * Which root the path is relative to: the REST API under `/app/rest`, or the
   * server root, which serves the one plain-text endpoint (the build log).
   */
  readonly root?: "rest" | "server";
  /** Decoded artifact path, so the projection can name children of it. */
  readonly artifactPath?: string | undefined;
}

export type TeamCityOperationHandler = (
  input: Readonly<Record<string, unknown>>,
  context: OperationContext,
) => TeamCityRequest;

/* ------------------------------------------------------------------ */
/* Companions of the operations that need more than one call           */
/* ------------------------------------------------------------------ */

export function serverRequest(): TeamCityRequest {
  return {
    path: "/server",
    query: {
      fields: "version,versionMajor,versionMinor,buildNumber,startTime,webUrl",
    },
  };
}

export function currentUserRequest(): TeamCityRequest {
  return {
    path: "/users/current",
    query: { fields: "id,username,name,email" },
  };
}

/**
 * Failed tests and problems carry no `count` dimension here: the specification
 * names the bare locator for both, and the answer is bounded by slicing the
 * collection in the projection, which costs nothing and cannot 400 the call.
 */
export function testsRequest(buildId: number): TeamCityRequest {
  return {
    path: "/testOccurrences",
    query: {
      locator: nested("build", dimension("id", buildId)),
      fields:
        "count,nextHref,testOccurrence(id,name,status,duration,muted,newFailure,details)",
    },
  };
}

export function problemsRequest(buildId: number): TeamCityRequest {
  return {
    path: "/problemOccurrences",
    query: {
      locator: nested("build", dimension("id", buildId)),
      fields:
        "count,nextHref,problemOccurrence(id,type,identity,details,muted,newFailure)",
    },
  };
}

/** The one endpoint TeamCity serves outside `/app/rest`, in plain text. */
export function buildLogRequest(buildId: number): TeamCityRequest {
  return {
    path: "/downloadBuildLog.html",
    query: { buildId: String(buildId), plain: "true" },
    root: "server",
  };
}

export const TEAMCITY_HANDLERS: Readonly<
  Record<string, TeamCityOperationHandler>
> = Object.freeze({
  "connection.get": () => serverRequest(),

  "projects.list": (input) => {
    const parent = optionalEntityId(
      input["parentProjectId"],
      "parentProjectId",
    );
    return {
      path: "/projects",
      query: {
        // An unsupported dimension is a 400 from TeamCity, so the locator only
        // carries dimensions the API documents. `includeArchived` and the
        // free-text query are applied by the projection over the returned page.
        ...(parent === undefined
          ? {}
          : { locator: nested("parentProject", dimension("id", parent)) }),
        fields:
          "count,nextHref,project(id,name,parentProjectId,description,archived,webUrl)",
      },
    };
  },

  "buildConfigs.list": (input) => {
    const project = optionalEntityId(input["projectId"], "projectId");
    return {
      path: "/buildTypes",
      query: {
        ...(project === undefined
          ? {}
          : { locator: nested("project", dimension("id", project)) }),
        fields:
          "count,nextHref,buildType(id,name,projectId,projectName,description,paused,webUrl)",
      },
    };
  },

  "builds.list": (input) => {
    const locator = buildBuildLocator({
      buildTypeId: optionalEntityId(input["buildTypeId"], "buildTypeId"),
      projectId: optionalEntityId(input["projectId"], "projectId"),
      branch: optionalBranch(input["branch"], "branch"),
      status: optionalChoice(input["status"], BUILD_STATUSES, "status", 3, 16),
      state: optionalChoice(input["state"], BUILD_STATES, "state", 3, 16),
      personal: optionalBoolean(input["personal"], "personal"),
      since: optionalDateValue(input["since"], "since"),
      until: optionalDateValue(input["until"], "until"),
      count: listLimit(input["limit"], TEAMCITY_LIMITS.builds),
    });
    return {
      path: "/builds",
      query: {
        ...(locator === "" ? {} : { locator }),
        fields: `count,nextHref,build(${BUILD_FIELDS})`,
      },
    };
  },

  "builds.get": (input) => ({
    path: `/builds/${buildLocator(requiredInteger(input["buildId"], "buildId"))}`,
    query: { fields: BUILD_FIELDS },
  }),

  "builds.changes": (input) => ({
    path: "/changes",
    query: {
      locator: `${nested("build", dimension("id", requiredInteger(input["buildId"], "buildId")))},${dimension("count", listLimit(input["limit"], TEAMCITY_LIMITS.changes))}`,
      fields: "count,nextHref,change(id,version,username,date,comment,webUrl)",
    },
  }),

  "failures.get": (input) =>
    testsRequest(requiredInteger(input["buildId"], "buildId")),

  "builds.log": (input) =>
    buildLogRequest(requiredInteger(input["buildId"], "buildId")),

  "queue.list": (input) => {
    const project = optionalEntityId(input["projectId"], "projectId");
    const buildType = optionalEntityId(input["buildTypeId"], "buildTypeId");
    const locator = [
      ...(project === undefined
        ? []
        : [nested("project", dimension("id", project))]),
      ...(buildType === undefined
        ? []
        : [nested("buildType", dimension("id", buildType))]),
      dimension("count", listLimit(input["limit"], TEAMCITY_LIMITS.queued)),
    ].join(",");
    return {
      path: "/buildQueue",
      query: { locator, fields: `count,nextHref,build(${BUILD_FIELDS})` },
    };
  },

  "investigations.list": (input, context) => {
    const project = optionalEntityId(input["projectId"], "projectId");
    const buildType = optionalEntityId(input["buildTypeId"], "buildTypeId");
    const assignee = optionalText(input["assignee"], "assignee", 1, 32);
    // Only the connected user may be asked about by name; "me" is resolved
    // server-side from the stored integration, so no tool argument can point
    // the read at somebody else's investigations.
    if (assignee !== undefined && assignee !== "me") invalid("assignee");
    const locator = [
      ...(project === undefined
        ? []
        : [nested("project", dimension("id", project))]),
      ...(buildType === undefined
        ? []
        : [nested("buildType", dimension("id", buildType))]),
      ...(assignee === "me"
        ? [
            nested(
              "assignee",
              dimension(
                "id",
                externalUserIdFrom(context.externalUserId, "assignee=me"),
              ),
            ),
          ]
        : []),
      ...(input["state"] === undefined
        ? []
        : [
            dimension(
              "state",
              optionalChoice(
                input["state"],
                INVESTIGATION_STATES,
                "state",
                3,
                16,
              ) ?? "",
            ),
          ]),
      dimension(
        "count",
        listLimit(input["limit"], TEAMCITY_LIMITS.investigations),
      ),
    ].join(",");
    // The investigation DTO is variant across TeamCity versions, so this read
    // keeps the server's default projection and normalizes defensively.
    return { path: "/investigations", query: { locator } };
  },

  "agents.list": (input) => {
    const flag = (
      name: string,
      value: boolean | undefined,
    ): string | undefined =>
      value === undefined ? undefined : dimension(name, String(value));
    const locator = [
      flag("connected", optionalBoolean(input["connected"], "connected")),
      flag("enabled", optionalBoolean(input["enabled"], "enabled")),
      flag("authorized", optionalBoolean(input["authorized"], "authorized")),
      dimension("count", listLimit(input["limit"], TEAMCITY_LIMITS.agents)),
    ]
      .filter((part): part is string => part !== undefined)
      .join(",");
    return { path: "/agents", query: { locator } };
  },

  "artifacts.list": (input) => {
    const buildId = requiredInteger(input["buildId"], "buildId");
    const path = artifactPath(input["path"], "path", true);
    return {
      // An empty path is the artifact root, which TeamCity spells with the
      // trailing slash after `children`.
      path: `/builds/${buildLocator(buildId)}/artifacts/children/${path.encoded}`,
      query: {},
      artifactPath: path.decoded,
    };
  },

  "artifacts.text": (input) => {
    const buildId = requiredInteger(input["buildId"], "buildId");
    const path = artifactPath(input["path"]);
    return {
      path: `/builds/${buildLocator(buildId)}/artifacts/content/${path.encoded}`,
      query: {},
      artifactPath: path.decoded,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Response shaping                                                    */
/* ------------------------------------------------------------------ */

/** TeamCity wraps a collection in a named array; an empty page answers alone. */
function collectionOf(source: Record<string, unknown>, key: string): unknown[] {
  const held = source[key];
  if (Array.isArray(held)) return held;
  return Object.keys(source).length === 0 ? [] : [source];
}

/** One bounded string field: an unbounded diagnostic would drown the answer. */
function bounded(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function matches(text: string | undefined, needle: string): boolean {
  return text !== undefined && text.toLowerCase().includes(needle);
}

const TC_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{4})$/u;

/** TeamCity dates are `yyyyMMddTHHmmss±ZZZZ`; the model gets ISO-8601. */
export function isoDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parts = TC_DATE.exec(value);
  if (parts === null) return value;
  const [yy = "", mm = "", dd = "", hh = "", mi = "", ss = "", zone = "+0000"] =
    parts.slice(1);
  const date = new Date(
    `${yy}-${mm}-${dd}T${hh}:${mi}:${ss}${zone.slice(0, 3)}:${zone.slice(3)}`,
  );
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function listEnvelope(
  items: readonly unknown[],
  source: Record<string, unknown>,
): Record<string, unknown> {
  return {
    items,
    pagination: compact({
      returned: items.length,
      // TeamCity sends `nextHref` only when the collection continues. The tool
      // never follows it, but the model has to know its filter was cut short.
      hasMore: stringOf(source, "nextHref") === undefined ? undefined : true,
    }),
  };
}

function normalizeBuild(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const buildType = recordOf(source["buildType"]);
  const agent = recordOf(source["agent"]);
  const triggered = recordOf(source["triggered"]);
  const user = recordOf(triggered["user"]);
  return compact({
    id: numberOf(source, "id"),
    number: stringOf(source, "number"),
    state: stringOf(source, "state"),
    status: stringOf(source, "status"),
    statusText: stringOf(source, "statusText"),
    branchName: stringOf(source, "branchName"),
    personal: booleanOf(source, "personal") === true ? true : undefined,
    buildType: compact({
      id: stringOf(buildType, "id"),
      name: stringOf(buildType, "name"),
      projectId: stringOf(buildType, "projectId"),
      projectName: stringOf(buildType, "projectName"),
    }),
    agent: compact({
      id: numberOf(agent, "id"),
      name: stringOf(agent, "name"),
    }),
    triggered: compact({
      type: stringOf(triggered, "type"),
      username: stringOf(user, "username"),
      userName: stringOf(user, "name"),
    }),
    queuedAt: isoDate(stringOf(source, "queuedDate")),
    startedAt: isoDate(stringOf(source, "startDate")),
    finishedAt: isoDate(stringOf(source, "finishDate")),
    webUrl: stringOf(source, "webUrl"),
  });
}

function projectSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    name: stringOf(source, "name"),
    parentProjectId: stringOf(source, "parentProjectId"),
    description: bounded(stringOf(source, "description"), DETAILS_CHARS),
    archived: booleanOf(source, "archived") === true ? true : undefined,
    webUrl: stringOf(source, "webUrl"),
  });
}

function buildTypeSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    name: stringOf(source, "name"),
    projectId: stringOf(source, "projectId"),
    projectName: stringOf(source, "projectName"),
    description: bounded(stringOf(source, "description"), DETAILS_CHARS),
    paused: booleanOf(source, "paused") === true ? true : undefined,
    webUrl: stringOf(source, "webUrl"),
  });
}

function changeSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: numberOf(source, "id"),
    version: stringOf(source, "version"),
    username: stringOf(source, "username"),
    date: isoDate(stringOf(source, "date")),
    comment: bounded(stringOf(source, "comment"), COMMENT_CHARS),
    webUrl: stringOf(source, "webUrl"),
  });
}

function testOccurrenceSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    name: stringOf(source, "name"),
    status: stringOf(source, "status"),
    durationMs: numberOf(source, "duration"),
    muted: booleanOf(source, "muted") === true ? true : undefined,
    newFailure: booleanOf(source, "newFailure") === true ? true : undefined,
    details: bounded(stringOf(source, "details"), DETAILS_CHARS),
  });
}

function problemOccurrenceSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    type: stringOf(source, "type"),
    identity: stringOf(source, "identity"),
    muted: booleanOf(source, "muted") === true ? true : undefined,
    newFailure: booleanOf(source, "newFailure") === true ? true : undefined,
    details: bounded(stringOf(source, "details"), DETAILS_CHARS),
  });
}

function agentSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: numberOf(source, "id"),
    name: stringOf(source, "name"),
    connected: booleanOf(source, "connected"),
    enabled: booleanOf(source, "enabled"),
    authorized: booleanOf(source, "authorized"),
  });
}

function investigationSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const assignee = recordOf(source["assignee"]);
  const resolution = recordOf(source["resolution"]);
  return compact({
    id: stringOf(source, "id") ?? numberOf(source, "id"),
    state: stringOf(source, "state"),
    assignee: compact({
      id: numberOf(assignee, "id"),
      username: stringOf(assignee, "username"),
      name: stringOf(assignee, "name"),
    }),
    buildTypeId: stringOf(recordOf(source["buildType"]), "id"),
    testName: stringOf(recordOf(source["test"]), "name"),
    problemIdentity: stringOf(recordOf(source["problem"]), "identity"),
    resolution: compact({
      type: stringOf(resolution, "type"),
      time: isoDate(stringOf(resolution, "time")),
    }),
  });
}

/** A child of the listing: a directory is one that offers a children link. */
function artifactEntry(
  value: unknown,
  parentPath: string,
): Record<string, unknown> {
  const source = recordOf(value);
  const name = stringOf(source, "name") ?? "";
  const directory = source["children"] !== undefined;
  return compact({
    name,
    path: parentPath === "" ? name : `${parentPath}/${name}`,
    kind: directory ? "directory" : "file",
    size: directory ? undefined : numberOf(source, "size"),
    modified: isoDate(stringOf(source, "modificationTime")),
  });
}

export interface TeamCityProjectionContext {
  readonly flags: TeamCityFlags;
  /**
   * The validated tool arguments. TeamCity cannot filter by a name substring or
   * by "archived only", so those filters are applied here, over the page the
   * server returned; the model is told so in the tool description.
   */
  readonly input: Readonly<Record<string, unknown>>;
  /** Canonical server address, echoed so the model can link back to the UI. */
  readonly serverUrl?: string | undefined;
  /** Decoded path of an artifact listing, so children carry a full path. */
  readonly artifactPath?: string | undefined;
}

export type TeamCityProjection = (
  data: unknown,
  context: TeamCityProjectionContext,
) => unknown;

export const TEAMCITY_PROJECTIONS: Readonly<
  Record<string, TeamCityProjection>
> = Object.freeze({
  "connection.get": (data, context) => {
    const source = recordOf(data);
    const server = recordOf(source["server"]);
    const user = recordOf(source["user"]);
    return compact({
      serverUrl: context.serverUrl,
      version: stringOf(server, "version"),
      versionMajor: numberOf(server, "versionMajor"),
      versionMinor: numberOf(server, "versionMinor"),
      buildNumber: stringOf(server, "buildNumber"),
      serverStartedAt: isoDate(stringOf(server, "startTime")),
      serverWebUrl: stringOf(server, "webUrl"),
      user: compact({
        id: numberOf(user, "id"),
        username: stringOf(user, "username"),
        name: stringOf(user, "name"),
        email: stringOf(user, "email"),
      }),
    });
  },

  "projects.list": (data, context) => {
    const source = recordOf(data);
    const query = (context.input["query"] ?? "")
      .toString()
      .trim()
      .toLowerCase();
    const includeArchived = context.input["includeArchived"] === true;
    const items = collectionOf(source, "project")
      .map(projectSummary)
      // A page of TeamCity's project list mixes archived projects with live
      // ones, so the two filters the API cannot express are applied here.
      .filter((project) => includeArchived || project["archived"] !== true)
      .filter(
        (project) =>
          query === "" ||
          matches(project["id"] as string | undefined, query) ||
          matches(project["name"] as string | undefined, query),
      );
    return listEnvelope(items, source);
  },

  "buildConfigs.list": (data, context) => {
    const source = recordOf(data);
    const query = (context.input["query"] ?? "")
      .toString()
      .trim()
      .toLowerCase();
    const includePaused = context.input["includePaused"] === true;
    const items = collectionOf(source, "buildType")
      .map(buildTypeSummary)
      .filter((buildType) => includePaused || buildType["paused"] !== true)
      .filter(
        (buildType) =>
          query === "" ||
          matches(buildType["id"] as string | undefined, query) ||
          matches(buildType["name"] as string | undefined, query),
      );
    return listEnvelope(items, source);
  },

  "builds.list": (data) => {
    const source = recordOf(data);
    return listEnvelope(
      collectionOf(source, "build").map(normalizeBuild),
      source,
    );
  },

  "builds.get": (data) => normalizeBuild(data),

  "builds.changes": (data) => {
    const source = recordOf(data);
    return listEnvelope(
      collectionOf(source, "change").map(changeSummary),
      source,
    );
  },

  "failures.get": (data, context) => {
    const source = recordOf(data);
    const tests = recordOf(source["tests"]);
    const problems = recordOf(source["problems"]);
    const testLimit = listLimit(context.input["limit"], TEAMCITY_LIMITS.tests);
    const problemLimit = listLimit(
      context.input["limit"],
      TEAMCITY_LIMITS.problems,
    );
    // Only failures: the tool answers "why did it break", and a build with
    // four thousand passing tests would otherwise spend the answer on them.
    const failedTests = collectionOf(tests, "testOccurrence")
      .map(testOccurrenceSummary)
      .filter((test) => test["status"] !== "SUCCESS");
    const problemItems = collectionOf(problems, "problemOccurrence").map(
      problemOccurrenceSummary,
    );
    return compact({
      buildId: numberOf(source, "buildId"),
      failedTests: failedTests.slice(0, testLimit),
      problems: problemItems.slice(0, problemLimit),
      // Something was left out: either the server had another page, or the
      // answer was cut at the deployment limit.
      truncated:
        failedTests.length > testLimit ||
        problemItems.length > problemLimit ||
        stringOf(tests, "nextHref") !== undefined ||
        stringOf(problems, "nextHref") !== undefined
          ? true
          : undefined,
    });
  },

  "queue.list": (data) => {
    const source = recordOf(data);
    return listEnvelope(
      collectionOf(source, "build").map(normalizeBuild),
      source,
    );
  },

  "investigations.list": (data) => {
    const source = recordOf(data);
    return listEnvelope(
      collectionOf(source, "investigation").map(investigationSummary),
      source,
    );
  },

  "agents.list": (data, context) => {
    const source = recordOf(data);
    const query = (context.input["query"] ?? "")
      .toString()
      .trim()
      .toLowerCase();
    const items = collectionOf(source, "agent")
      .map(agentSummary)
      .filter(
        (agent) =>
          query === "" || matches(agent["name"] as string | undefined, query),
      );
    return listEnvelope(items, source);
  },

  "artifacts.list": (data, context) => {
    const source = recordOf(data);
    const parent = context.artifactPath ?? "";
    return listEnvelope(
      collectionOf(source, "file").map((entry) => artifactEntry(entry, parent)),
      source,
    );
  },
});
