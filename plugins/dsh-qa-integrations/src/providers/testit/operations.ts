import {
  optionalBoolean,
  optionalInteger,
  optionalText,
  requiredText,
} from "../../coerce.js";
import { IntegrationError } from "../../errors.js";
import type { TestitFlags } from "./config.js";
import type { TestitPage } from "./transport.js";

/**
 * Request building and response shaping for the Test IT Open API v2.
 *
 * Every operation answers with a normalized object instead of Test IT's own
 * DTO, and every list answers with the same `{ items, pagination }` envelope, so
 * the model learns one shape rather than a dozen. Text a user typed into Test IT
 * — descriptions, steps, comments, traces, names of configurations — is
 * untrusted external content and reaches the model under `untrustedContent` or
 * as a bounded block, never as a bare string that could read as an instruction.
 */

/**
 * Hard caps per collection, from the provider specification. They bound what one
 * answer may carry; Test IT documents no ceiling of its own for `Take`.
 */
export const TESTIT_LIMITS = Object.freeze({
  projects: 100,
  sections: 100,
  workItems: 100,
  history: 100,
  comments: 100,
  testPlans: 100,
  testRuns: 50,
  testResults: 100,
  attachments: 100,
  autoTests: 100,
  configurations: 100,
});

/**
 * Values Test IT accepts for the fields this provider exposes. The vocabulary is
 * closed on purpose: an enum the model cannot spell is a 400 from upstream, and
 * a 400 costs an answer where a refused argument costs one line.
 */
export const WORK_ITEM_STATES: readonly string[] = Object.freeze([
  "NeedsWork",
  "NotReady",
  "Ready",
]);
export const WORK_ITEM_PRIORITIES: readonly string[] = Object.freeze([
  "Lowest",
  "Low",
  "Medium",
  "High",
  "Highest",
]);
export const WORK_ITEM_ENTITY_TYPES: readonly string[] = Object.freeze([
  "TestCases",
  "CheckLists",
  "SharedSteps",
]);
export const TEST_RUN_STATES: readonly string[] = Object.freeze([
  "NotStarted",
  "InProgress",
  "Stopped",
  "Completed",
]);
export const RESULT_OUTCOMES: readonly string[] = Object.freeze([
  "InProgress",
  "Passed",
  "Failed",
  "Skipped",
  "Blocked",
]);

/** An absurd `limit` is clamped, not refused, so the cap still answers. */
const MAX_ASKED_LIMIT = 100_000;
const MAX_OFFSET = 1_000_000;
/** Test IT ids are UUIDs; the shape is what keeps them inside a path segment. */
const ENTITY_ID = /^[A-Za-z0-9-]{1,64}$/u;
const DETAILS_CHARS = 1_000;
const TEXT_CHARS = 2_000;
const CONFIG_TEXT_CHARS = 200;

function invalid(field: string): never {
  throw new IntegrationError("InvalidRequest", `${field} is invalid`);
}

/** One Test IT identifier: a project, work item, run, result or attachment id. */
function entityId(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 1, 64);
  if (!ENTITY_ID.test(normalized)) invalid(field);
  return normalized;
}

function optionalEntityId(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : entityId(value, field);
}

function oneOf(
  value: unknown,
  allowed: readonly string[],
  field: string,
  maxLength: number,
): string | undefined {
  const normalized = optionalText(value, field, 1, maxLength);
  if (normalized === undefined) return undefined;
  if (!allowed.includes(normalized)) invalid(field);
  return normalized;
}

/**
 * A timestamp or a plain date. Test IT serves its own ISO-8601 strings back, so
 * the value is passed through once it parses: the provider refuses a value it
 * cannot read rather than forwarding something upstream would 400 on.
 */
function optionalMoment(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = requiredText(value, field, 8, 40);
  if (Number.isNaN(Date.parse(normalized))) invalid(field);
  return normalized;
}

/** The `states` filter of a run search, as the four flags upstream wants. */
function runStateFlags(value: unknown): readonly string[] {
  if (value === undefined) return TEST_RUN_STATES;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > TEST_RUN_STATES.length
  ) {
    invalid("states");
  }
  return value.map((item) => {
    const state = oneOf(item, TEST_RUN_STATES, "states", 16);
    if (state === undefined) invalid("states");
    return state;
  });
}

/**
 * Rows one call may ask for: the caller's wish is clamped to the deployment cap
 * rather than refused, because a model that asks for "the last 500 test cases"
 * still gets a useful answer instead of an error.
 */
export function listLimit(
  requested: unknown,
  cap: number,
  flags: TestitFlags,
): number {
  if (requested === undefined) {
    return Math.min(flags.defaultResults, cap, flags.maxResults);
  }
  const asked = optionalInteger(requested, "limit", 1, MAX_ASKED_LIMIT);
  return Math.min(asked ?? cap, cap, flags.maxResults);
}

/** Rows to skip; `offset` is the model's only pagination cursor here. */
export function listOffset(requested: unknown): number {
  return optionalInteger(requested, "offset", 0, MAX_OFFSET) ?? 0;
}

export interface OperationContext {
  readonly flags: TestitFlags;
}

export interface TestitRequest {
  readonly path: string;
  readonly query: Readonly<Record<string, string | undefined>>;
}

export type TestitOperationHandler = (
  input: Readonly<Record<string, unknown>>,
  context: OperationContext,
) => TestitRequest;

/* ------------------------------------------------------------------ */
/* Request building                                                    */
/* ------------------------------------------------------------------ */

export const TESTIT_HANDLERS: Readonly<Record<string, TestitOperationHandler>> =
  Object.freeze({
    // The connection probe is the documented first validation call: an authorized
    // answer to the project list proves the address and the token at once. `Take`
    // is pinned to one row because the answer is measured, not read.
    "connection.get": () => ({ path: "/projects", query: { Take: "1" } }),

    "projects.list": (input, context) => ({
      path: "/projects",
      query: {
        Skip: String(listOffset(input["offset"])),
        Take: String(
          listLimit(input["limit"], TESTIT_LIMITS.projects, context.flags),
        ),
      },
    }),

    "projects.get": (input) => ({
      path: `/projects/${entityId(input["projectId"], "projectId")}`,
      query: {},
    }),

    "sections.list": (input, context) => ({
      path: `/projects/${entityId(input["projectId"], "projectId")}/sections`,
      query: {
        Skip: String(listOffset(input["offset"])),
        Take: String(
          listLimit(input["limit"], TESTIT_LIMITS.sections, context.flags),
        ),
      },
    }),

    "workItems.list": (input, context) => ({
      path: `/projects/${entityId(input["projectId"], "projectId")}/workItems`,
      query: {
        Skip: String(listOffset(input["offset"])),
        Take: String(
          listLimit(input["limit"], TESTIT_LIMITS.workItems, context.flags),
        ),
      },
    }),

    "workItems.get": (input) => ({
      path: `/workItems/${entityId(input["workItemId"], "workItemId")}`,
      query: {},
    }),

    "workItems.history": (input, context) => ({
      path: `/workItems/${entityId(input["workItemId"], "workItemId")}/history`,
      query: {
        Skip: String(listOffset(input["offset"])),
        Take: String(
          listLimit(input["limit"], TESTIT_LIMITS.history, context.flags),
        ),
      },
    }),

    "workItems.comments": (input) => ({
      path: `/workItems/${entityId(input["workItemId"], "workItemId")}/comments`,
      query: {},
    }),

    "workItems.testResults": (input, context) => ({
      path: `/workItems/${entityId(input["workItemId"], "workItemId")}/testResults/history`,
      query: {
        Skip: String(listOffset(input["offset"])),
        Take: String(
          listLimit(input["limit"], TESTIT_LIMITS.testResults, context.flags),
        ),
      },
    }),

    "testPlans.list": (input) => ({
      path: `/projects/${entityId(input["projectId"], "projectId")}/testPlans`,
      query: {},
    }),

    "testPlans.get": (input) => ({
      path: `/testPlans/${entityId(input["testPlanId"], "testPlanId")}`,
      query: {},
    }),

    "testPlans.summary": (input) => ({
      path: `/testPlans/${entityId(input["testPlanId"], "testPlanId")}/summaries`,
      query: {},
    }),

    "testRuns.list": (input, context) => {
      const states = runStateFlags(input["states"]);
      const testPlanId = optionalEntityId(input["testPlanId"], "testPlanId");
      return {
        path: `/projects/${entityId(input["projectId"], "projectId")}/testRuns`,
        query: {
          // The four state flags are required by this endpoint; the provider
          // always sends all four, so "no filter" is four explicit `true`s.
          notStarted: states.includes("NotStarted") ? "true" : "false",
          inProgress: states.includes("InProgress") ? "true" : "false",
          stopped: states.includes("Stopped") ? "true" : "false",
          completed: states.includes("Completed") ? "true" : "false",
          createdDateFrom: optionalMoment(input["createdFrom"], "createdFrom"),
          createdDateTo: optionalMoment(input["createdTo"], "createdTo"),
          ...(testPlanId === undefined ? {} : { testPlanId }),
          Skip: String(listOffset(input["offset"])),
          Take: String(
            listLimit(input["limit"], TESTIT_LIMITS.testRuns, context.flags),
          ),
        },
      };
    },

    "testRuns.get": (input) => ({
      path: `/testRuns/${entityId(input["testRunId"], "testRunId")}`,
      query: {},
    }),

    "testRuns.results": (input) => ({
      path: `/testRuns/${entityId(input["testRunId"], "testRunId")}/testPoints/results`,
      query: {},
    }),

    "testResults.get": (input) => ({
      path: `/testResults/${entityId(input["testResultId"], "testResultId")}`,
      query: {},
    }),

    "testResults.attachments": (input) => ({
      path: `/testResults/${entityId(input["testResultId"], "testResultId")}/attachments`,
      query: {},
    }),

    "attachments.metadata": (input) => ({
      path: `/attachments/${entityId(input["attachmentId"], "attachmentId")}/metadata`,
      query: {},
    }),

    // The provider reads this one as bytes, not as JSON; the handler only builds
    // the address, so the id is validated here exactly like everywhere else.
    "attachments.text": (input) => ({
      path: `/attachments/${entityId(input["attachmentId"], "attachmentId")}`,
      query: {},
    }),

    "autoTests.list": (input, context) => {
      const projectId = optionalEntityId(input["projectId"], "projectId");
      return {
        path: "/autoTests",
        query: {
          ...(projectId === undefined ? {} : { projectId }),
          namespace: optionalText(input["namespace"], "namespace", 1, 255),
          className: optionalText(input["className"], "className", 1, 512),
          externalId: optionalText(input["externalId"], "externalId", 1, 512),
          flaky: optionalBoolean(input["flaky"], "flaky")?.toString(),
          includeSteps: optionalBoolean(
            input["includeSteps"],
            "includeSteps",
          )?.toString(),
          Skip: String(listOffset(input["offset"])),
          Take: String(
            listLimit(input["limit"], TESTIT_LIMITS.autoTests, context.flags),
          ),
        },
      };
    },

    "autoTests.get": (input) => ({
      path: `/autoTests/${entityId(input["autoTestId"], "autoTestId")}`,
      query: {},
    }),

    "configurations.list": (input) => ({
      path: `/projects/${entityId(input["projectId"], "projectId")}/configurations`,
      query: {},
    }),
  });

/* ------------------------------------------------------------------ */
/* Response shaping                                                    */
/* ------------------------------------------------------------------ */

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

/** External text a projection collected; omitted entirely when there is none. */
function contentOf(
  entries: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const block = compact(entries);
  return Object.keys(block).length === 0 ? undefined : block;
}

function itemsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  // A single-resource answer that upstream wrapped in an array (the plan
  // summaries endpoint answers a collection) still reads as one item.
  return typeof value === "object" && value !== null ? [value] : [];
}

/** One bounded string field: an unbounded answer would drown the tool result. */
export function bounded(
  value: string | undefined,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/**
 * One block of external text. Test IT content is written by people and by
 * test tooling, so it is handed over as data with its size and a truncation
 * marker, never as a string the model could read as an instruction.
 */
export function contentBlock(
  text: string | undefined,
  limit: number,
): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  const totalChars = text.length;
  return {
    format: "plain",
    text: totalChars <= limit ? text : text.slice(0, limit),
    totalChars,
    truncated: totalChars > limit,
  };
}

/** A bounded MIME-agnostic value out of a `{String: String}` or `{String: Object}` map. */
function valueText(value: unknown, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  return bounded(raw, limit);
}

function mapObject(
  value: unknown,
  limit: number,
): Record<string, string> | undefined {
  const source = recordOf(value);
  const entries = Object.entries(source)
    .map(([key, item]): [string, string] | undefined => {
      const text = valueText(item, limit);
      return text === undefined ? undefined : [key, text];
    })
    .filter((entry): entry is [string, string] => entry !== undefined);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function compactList(value: unknown): Record<string, unknown>[] | undefined {
  const items = arrayOf(value)
    .map((item) => compact(recordOf(item)))
    .filter((item) => Object.keys(item).length > 0);
  return items.length === 0 ? undefined : items;
}

/** The upstream status reference a run, test point or result carries. */
function statusOf(value: unknown): Record<string, unknown> | undefined {
  const source = recordOf(value);
  const status = compact({
    name: stringOf(source, "name"),
    code: stringOf(source, "code"),
    type: stringOf(source, "type"),
    isSystem: booleanOf(source, "isSystem"),
  });
  return Object.keys(status).length === 0 ? undefined : status;
}

function attachmentSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    name: bounded(stringOf(source, "name"), 255),
    type: stringOf(source, "type"),
    size: numberOf(source, "size"),
    createdDate: stringOf(source, "createdDate"),
    createdById: stringOf(source, "createdById"),
  });
}

function attachmentsOf(value: unknown): Record<string, unknown>[] | undefined {
  const items = arrayOf(value).map(attachmentSummary);
  return items.length === 0 ? undefined : items;
}

function linkSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    title: bounded(stringOf(source, "title"), 255),
    url: bounded(stringOf(source, "url"), 2_048),
    type: stringOf(source, "type"),
  });
}

function linksOf(value: unknown): Record<string, unknown>[] | undefined {
  const items = arrayOf(value).map(linkSummary);
  return items.length === 0 ? undefined : items;
}

function tagNames(value: unknown): string[] | undefined {
  const items = arrayOf(value)
    .map((item) =>
      typeof item === "string" ? item : stringOf(recordOf(item), "name"),
    )
    .filter((item): item is string => item !== undefined && item !== "");
  return items.length === 0 ? undefined : items;
}

function iterationSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const parameters = arrayOf(source["parameters"])
    .map((item) => {
      const parameter = recordOf(item);
      return compact({
        name: stringOf(parameter, "name"),
        value: bounded(stringOf(parameter, "value"), CONFIG_TEXT_CHARS),
      });
    })
    .filter((item) => Object.keys(item).length > 0);
  return compact({
    id: stringOf(source, "id"),
    parameters: parameters.length === 0 ? undefined : parameters,
  });
}

function iterationsOf(value: unknown): Record<string, unknown>[] | undefined {
  const items = arrayOf(value).map(iterationSummary);
  return items.length === 0 ? undefined : items;
}

/**
 * One work item step. Action, expected result and test data are the text a QA
 * engineer wrote, so each is its own bounded block and none of them is spliced
 * into an instruction-shaped string.
 */
function stepSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const shared = recordOf(source["workItem"]);
  return compact({
    id: stringOf(source, "id"),
    action: contentBlock(stringOf(source, "action"), TEXT_CHARS),
    expected: contentBlock(stringOf(source, "expected"), TEXT_CHARS),
    testData: contentBlock(stringOf(source, "testData"), TEXT_CHARS),
    comments: contentBlock(stringOf(source, "comments"), TEXT_CHARS),
    sharedStepId: stringOf(shared, "id"),
    sharedStepName: bounded(stringOf(shared, "name"), 255),
  });
}

function stepsOf(value: unknown): Record<string, unknown>[] | undefined {
  const items = arrayOf(value).map(stepSummary);
  return items.length === 0 ? undefined : items;
}

function attributeSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    name: bounded(stringOf(source, "name"), 255),
    type: stringOf(source, "type"),
    isRequired: booleanOf(source, "isRequired"),
    isEnabled: booleanOf(source, "isEnabled"),
    options: arrayOf(source["options"])
      .map((item) => {
        const option = recordOf(item);
        return bounded(stringOf(option, "value"), CONFIG_TEXT_CHARS);
      })
      .filter((item): item is string => item !== undefined),
  });
}

/* ------------------------------------------------------------------ */
/* List envelopes                                                      */
/* ------------------------------------------------------------------ */

/**
 * A page of a collection Test IT pages itself. The count comes from the
 * `Pagination-Total-Items` header: the body is a bare array and the search
 * endpoints that would report a total are POST-only, so without the header the
 * model is told only whether the page looked full.
 */
export function paged(
  items: readonly unknown[],
  page: TestitPage | undefined,
  limit: number,
  offset: number,
): Record<string, unknown> {
  const returned = items.length;
  const total = page?.total;
  const hasMore =
    total === undefined
      ? returned >= limit && returned > 0
      : offset + returned < total;
  return {
    items,
    pagination: compact({
      offset,
      limit,
      returned,
      total,
      hasMore,
    }),
  };
}

/**
 * A collection Test IT answers whole. The provider slices it to the limit and
 * says `truncated`, so the model can narrow the request instead of believing a
 * cut list is the complete one.
 */
export function capped(
  items: readonly unknown[],
  limit: number,
): Record<string, unknown> {
  return {
    items: items.slice(0, limit),
    truncated: items.length > limit,
    pagination: { limit, returned: Math.min(items.length, limit) },
  };
}

/* ------------------------------------------------------------------ */
/* Projections                                                         */
/* ------------------------------------------------------------------ */

function projectSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    globalId: numberOf(source, "globalId"),
    name: bounded(stringOf(source, "name"), 255),
    description: contentBlock(stringOf(source, "description"), DETAILS_CHARS),
    type: stringOf(source, "type"),
    isFavorite: booleanOf(source, "isFavorite"),
    isDeleted: booleanOf(source, "isDeleted"),
    testCasesCount: numberOf(source, "testCasesCount"),
    checkListsCount: numberOf(source, "checkListsCount"),
    sharedStepsCount: numberOf(source, "sharedStepsCount"),
    autoTestsCount: numberOf(source, "autoTestsCount"),
    createdDate: stringOf(source, "createdDate"),
    modifiedDate: stringOf(source, "modifiedDate"),
    createdById: stringOf(source, "createdById"),
    modifiedById: stringOf(source, "modifiedById"),
  });
}

function sectionSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    projectId: stringOf(source, "projectId"),
    parentId: stringOf(source, "parentId"),
    name: bounded(stringOf(source, "name"), 255),
    isDeleted: booleanOf(source, "isDeleted"),
    createdDate: stringOf(source, "createdDate"),
    modifiedDate: stringOf(source, "modifiedDate"),
    createdById: stringOf(source, "createdById"),
    modifiedById: stringOf(source, "modifiedById"),
  });
}

function workItemSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    globalId: numberOf(source, "globalId"),
    versionId: stringOf(source, "versionId"),
    versionNumber: numberOf(source, "versionNumber"),
    name: bounded(stringOf(source, "name"), 255),
    entityTypeName: stringOf(source, "entityTypeName"),
    projectId: stringOf(source, "projectId"),
    sectionId: stringOf(source, "sectionId"),
    sectionName: bounded(stringOf(source, "sectionName"), 255),
    state: stringOf(source, "state"),
    priority: stringOf(source, "priority"),
    sourceType: stringOf(source, "sourceType"),
    isAutomated: booleanOf(source, "isAutomated"),
    isDeleted: booleanOf(source, "isDeleted"),
    durationMs: numberOf(source, "duration"),
    medianDurationMs: numberOf(source, "medianDuration"),
    tagNames: tagNames(source["tagNames"]),
    createdDate: stringOf(source, "createdDate"),
    modifiedDate: stringOf(source, "modifiedDate"),
    createdById: stringOf(source, "createdById"),
    modifiedById: stringOf(source, "modifiedById"),
  });
}

function workItemDetail(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const attributes = mapObject(source["attributes"], CONFIG_TEXT_CHARS);
  const parameters = arrayOf(source["parameters"])
    .map((item) => {
      const parameter = recordOf(item);
      return compact({
        id: stringOf(parameter, "id"),
        name: stringOf(parameter, "name"),
      });
    })
    .filter((item) => Object.keys(item).length > 0);
  return compact({
    ...workItemSummary(source),
    untrustedContent: contentOf({
      description: contentBlock(stringOf(source, "description"), TEXT_CHARS),
    }),
    attributes,
    parameters: parameters.length === 0 ? undefined : parameters,
    tags: tagNames(source["tags"]),
    steps: stepsOf(source["steps"]),
    preconditionSteps: stepsOf(source["preconditionSteps"]),
    postconditionSteps: stepsOf(source["postconditionSteps"]),
    sectionPreconditionSteps: stepsOf(source["sectionPreconditionSteps"]),
    sectionPostconditionSteps: stepsOf(source["sectionPostconditionSteps"]),
    iterations: iterationsOf(source["iterations"]),
    autoTests: compactList(source["autoTests"]),
    attachments: attachmentsOf(source["attachments"]),
    links: linksOf(source["links"]),
    externalIssues: arrayOf(source["externalIssues"])
      .map((item) => {
        const issue = recordOf(item);
        return compact({
          id: stringOf(issue, "id"),
          externalId: stringOf(issue, "externalId"),
          url: bounded(stringOf(issue, "url"), 2_048),
        });
      })
      .filter((item) => Object.keys(item).length > 0),
  });
}

/** One entry of the change log: which field moved, from where to where. */
function changedFields(value: unknown): Record<string, unknown>[] {
  return Object.entries(recordOf(value))
    .map(([field, item]) => {
      const change = recordOf(item);
      const from = valueText(change["oldValue"], CONFIG_TEXT_CHARS);
      const to = valueText(change["newValue"], CONFIG_TEXT_CHARS);
      if (from === undefined && to === undefined) return undefined;
      return compact({ field, from, to });
    })
    .filter((item): item is Record<string, unknown> => item !== undefined);
}

function historyEntry(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const fields = changedFields(source["workItemChangedFields"]);
  return compact({
    id: stringOf(source, "id"),
    workItemId: stringOf(source, "workItemId"),
    oldVersionId: stringOf(source, "oldVersionId"),
    newVersionId: stringOf(source, "newVersionId"),
    fields: fields.length === 0 ? undefined : fields,
    createdById: stringOf(source, "createdById"),
    createdDate: stringOf(source, "createdDate"),
  });
}

function commentEntry(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    untrustedContent: contentOf({
      text: contentBlock(stringOf(source, "text"), TEXT_CHARS),
    }),
    createdById: stringOf(source, "createdById"),
    createdDate: stringOf(source, "createdDate"),
    modifiedById: stringOf(source, "modifiedById"),
    modifiedDate: stringOf(source, "modifiedDate"),
  });
}

function testPlanEntry(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    globalId: numberOf(source, "globalId"),
    name: bounded(stringOf(source, "name"), 255),
    projectId: stringOf(source, "projectId"),
    status: stringOf(source, "status"),
    productName: bounded(stringOf(source, "productName"), 255),
    build: bounded(stringOf(source, "build"), 255),
    startDate: stringOf(source, "startDate"),
    endDate: stringOf(source, "endDate"),
    startedOn: stringOf(source, "startedOn"),
    completedOn: stringOf(source, "completedOn"),
    lockedDate: stringOf(source, "lockedDate"),
    lockedById: stringOf(source, "lockedById"),
    hasAutomaticDurationTimer: booleanOf(source, "hasAutomaticDurationTimer"),
    isDeleted: booleanOf(source, "isDeleted"),
    tags: tagNames(source["tags"]),
    createdDate: stringOf(source, "createdDate"),
    modifiedDate: stringOf(source, "modifiedDate"),
    createdById: stringOf(source, "createdById"),
    modifiedById: stringOf(source, "modifiedById"),
    untrustedContent: contentOf({
      description: contentBlock(stringOf(source, "description"), DETAILS_CHARS),
    }),
  });
}

function testPlanSummaryOf(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    totalTestPointsCount: numberOf(source, "totalTestPointsCount"),
    manualTestPointsCount: numberOf(source, "manualTestPointsCount"),
    automatedTestPointsCount: numberOf(source, "automatedTestPointsCount"),
    completedTestPointsCount: numberOf(source, "completedTestPointsCount"),
    defectsCount: numberOf(source, "defectsCount"),
    plannedTestPointsDurationMs: numberOf(source, "plannedTestPointsDuration"),
    spentTestPointsDurationMs: numberOf(source, "spentTestPointsDuration"),
  });
}

function testRunSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    name: bounded(stringOf(source, "name"), 255),
    projectId: stringOf(source, "projectId"),
    testPlanId: stringOf(source, "testPlanId"),
    stateName: stringOf(source, "stateName"),
    status: statusOf(source["status"]),
    launchSource: stringOf(source, "launchSource"),
    runCount: numberOf(source, "runCount"),
    startedOn: stringOf(source, "startedOn"),
    completedOn: stringOf(source, "completedOn"),
    createdDate: stringOf(source, "createdDate"),
    modifiedDate: stringOf(source, "modifiedDate"),
    createdById: stringOf(source, "createdById"),
    createdByUserName: stringOf(source, "createdByUserName"),
    tags: tagNames(source["tags"]),
    // A run list is a list of runs, not of their results: the results of one run
    // are a tool of their own, and folding them in here would answer one
    // question with the whole project's history.
    testResults: undefined,
  });
}

function testRunDetail(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    ...testRunSummary(source),
    untrustedContent: contentOf({
      description: contentBlock(stringOf(source, "description"), TEXT_CHARS),
    }),
    customParameters: mapObject(source["customParameters"], CONFIG_TEXT_CHARS),
    attachments: attachmentsOf(source["attachments"]),
    links: linksOf(source["links"]),
  });
}

function testResultHistoryEntry(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    testRunId: stringOf(source, "testRunId"),
    testRunName: bounded(stringOf(source, "testRunName"), 255),
    testPlanId: stringOf(source, "testPlanId"),
    testPlanName: bounded(stringOf(source, "testPlanName"), 255),
    configurationName: bounded(stringOf(source, "configurationName"), 255),
    isAutomated: booleanOf(source, "isAutomated"),
    outcome: stringOf(source, "outcome"),
    status: statusOf(source["status"]),
    launchSource: stringOf(source, "launchSource"),
    workItemVersionNumber: numberOf(source, "workItemVersionNumber"),
    startedOn: stringOf(source, "startedOn"),
    completedOn: stringOf(source, "completedOn"),
    durationMs: numberOf(source, "duration"),
    createdDate: stringOf(source, "createdDate"),
    createdById: stringOf(source, "createdById"),
    untrustedContent: contentOf({
      comment: contentBlock(stringOf(source, "comment"), TEXT_CHARS),
    }),
    attachments: attachmentsOf(source["attachments"]),
  });
}

function configurationShort(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    name: bounded(stringOf(source, "name"), 255),
  });
}

/** A short test result as it appears inside a test point. */
function testResultShort(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    outcome: stringOf(source, "outcome"),
    status: statusOf(source["status"]),
    untrustedContent: contentOf({
      comment: contentBlock(stringOf(source, "comment"), TEXT_CHARS),
      message: contentBlock(stringOf(source, "message"), TEXT_CHARS),
    }),
    autoTestId: stringOf(source, "autoTestId"),
    configurationId: stringOf(source, "configurationId"),
    configuration: configurationShort(source["configuration"]),
    startedOn: stringOf(source, "startedOn"),
    completedOn: stringOf(source, "completedOn"),
    durationMs: numberOf(source, "durationInMs"),
    attachments: attachmentsOf(source["attachments"]),
  });
}

function testPointResult(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const results = arrayOf(source["testResults"]).map(testResultShort);
  return compact({
    testPointId: stringOf(source, "testPointId"),
    workItemGlobalId: numberOf(source, "workItemGlobalId"),
    workItemName: bounded(stringOf(source, "workItemName"), 255),
    configurationName: bounded(stringOf(source, "configurationName"), 255),
    aggregatedOutcome: stringOf(source, "aggregatedOutcome"),
    aggregatedStatus: statusOf(source["aggregatedStatus"]),
    testResults: results.length === 0 ? undefined : results,
  });
}

function testResultDetail(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const stepResults = arrayOf(source["stepResults"]).map((item) => {
    const step = recordOf(item);
    return compact({
      stepId: stringOf(step, "stepId"),
      outcome: stringOf(step, "outcome"),
    });
  });
  return compact({
    id: stringOf(source, "id"),
    testRunId: stringOf(source, "testRunId"),
    testPointId: stringOf(source, "testPointId"),
    configurationId: stringOf(source, "configurationId"),
    workItemVersionId: stringOf(source, "workItemVersionId"),
    workItemVersionNumber: numberOf(source, "workItemVersionNumber"),
    autoTestId: stringOf(source, "autoTestId"),
    autoTest: compact({
      id: stringOf(recordOf(source["autoTest"]), "id"),
      name: bounded(stringOf(recordOf(source["autoTest"]), "name"), 255),
      namespace: stringOf(recordOf(source["autoTest"]), "namespace"),
      classname: stringOf(recordOf(source["autoTest"]), "classname"),
    }),
    outcome: stringOf(source, "outcome"),
    status: statusOf(source["status"]),
    failureType: stringOf(source, "failureType"),
    failureClassIds: arrayOf(source["failureClassIds"]).filter(
      (item): item is string => typeof item === "string",
    ),
    durationMs: numberOf(source, "durationInMs"),
    startedOn: stringOf(source, "startedOn"),
    completedOn: stringOf(source, "completedOn"),
    runByUserId: stringOf(source, "runByUserId"),
    stoppedByUserId: stringOf(source, "stoppedByUserId"),
    createdDate: stringOf(source, "createdDate"),
    modifiedDate: stringOf(source, "modifiedDate"),
    createdById: stringOf(source, "createdById"),
    modifiedById: stringOf(source, "modifiedById"),
    parameters: mapObject(source["parameters"], CONFIG_TEXT_CHARS),
    properties: mapObject(source["properties"], CONFIG_TEXT_CHARS),
    stepResults: stepResults.length === 0 ? undefined : stepResults,
    untrustedContent: contentOf({
      comment: contentBlock(stringOf(source, "comment"), TEXT_CHARS),
      message: contentBlock(stringOf(source, "message"), TEXT_CHARS),
      traces: contentBlock(stringOf(source, "traces"), TEXT_CHARS),
    }),
    attachments: attachmentsOf(source["attachments"]),
    links: linksOf(source["links"]),
  });
}

function autoTestSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    globalId: numberOf(source, "globalId"),
    projectId: stringOf(source, "projectId"),
    name: bounded(stringOf(source, "name"), 255),
    externalId: bounded(stringOf(source, "externalId"), 512),
    externalKey: bounded(stringOf(source, "externalKey"), 512),
    namespace: bounded(stringOf(source, "namespace"), 512),
    classname: bounded(stringOf(source, "classname"), 512),
    title: bounded(stringOf(source, "title"), 512),
    isFlaky: booleanOf(source, "isFlaky"),
    isDeleted: booleanOf(source, "isDeleted"),
    mustBeApproved: booleanOf(source, "mustBeApproved"),
    stabilityPercentage: numberOf(source, "stabilityPercentage"),
    lastTestRunId: stringOf(source, "lastTestRunId"),
    lastTestRunName: bounded(stringOf(source, "lastTestRunName"), 255),
    lastTestResultId: stringOf(source, "lastTestResultId"),
    lastTestResultOutcome: stringOf(source, "lastTestResultOutcome"),
    lastTestResultConfiguration: configurationShort(
      source["lastTestResultConfiguration"],
    ),
    labels: tagNames(source["labels"]),
    tags: tagNames(source["tags"]),
    createdDate: stringOf(source, "createdDate"),
    modifiedDate: stringOf(source, "modifiedDate"),
    createdById: stringOf(source, "createdById"),
    modifiedById: stringOf(source, "modifiedById"),
  });
}

/** One automatic-test step, nested the way Test IT nests them. */
function autoTestStep(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  const nested = arrayOf(source["steps"]).map(autoTestStep);
  return compact({
    title: bounded(stringOf(source, "title"), 512),
    description: contentBlock(stringOf(source, "description"), TEXT_CHARS),
    steps: nested.length === 0 ? undefined : nested,
  });
}

function autoTestDetail(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    ...autoTestSummary(source),
    untrustedContent: contentOf({
      description: contentBlock(stringOf(source, "description"), TEXT_CHARS),
    }),
    steps: arrayOf(source["steps"]).map(autoTestStep),
    setup: arrayOf(source["setup"]).map(autoTestStep),
    teardown: arrayOf(source["teardown"]).map(autoTestStep),
    links: linksOf(source["links"]),
  });
}

function configurationSummary(value: unknown): Record<string, unknown> {
  const source = recordOf(value);
  return compact({
    id: stringOf(source, "id"),
    globalId: numberOf(source, "globalId"),
    projectId: stringOf(source, "projectId"),
    name: bounded(stringOf(source, "name"), 255),
    isDefault: booleanOf(source, "isDefault"),
    isDeleted: booleanOf(source, "isDeleted"),
    parameters: mapObject(source["parameters"], CONFIG_TEXT_CHARS),
    createdDate: stringOf(source, "createdDate"),
    modifiedDate: stringOf(source, "modifiedDate"),
    createdById: stringOf(source, "createdById"),
    modifiedById: stringOf(source, "modifiedById"),
    untrustedContent: contentOf({
      description: contentBlock(stringOf(source, "description"), TEXT_CHARS),
    }),
  });
}

/** Text of the requested query, lowercased once per projection. */
function needle(input: Readonly<Record<string, unknown>>): string {
  return String(input["query"] ?? "")
    .trim()
    .toLowerCase();
}

function matches(value: string | undefined, query: string): boolean {
  return value !== undefined && value.toLowerCase().includes(query);
}

/** A page of items is narrowed the same way whichever collection it holds. */
function filterItems(
  items: readonly Record<string, unknown>[],
  input: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, unknown>[] {
  const query = needle(input);
  const includeDeleted = input["includeDeleted"] === true;
  return items
    .filter((item) => includeDeleted || item["isDeleted"] !== true)
    .filter(
      (item) =>
        query === "" ||
        fields.some((field) =>
          matches(item[field] as string | undefined, query),
        ),
    );
}

export interface TestitProjectionContext {
  readonly flags: TestitFlags;
  /** The validated tool arguments; filters the API cannot express live here. */
  readonly input: Readonly<Record<string, unknown>>;
  readonly page?: TestitPage | undefined;
  /** Label of the configured instance, echoed so the model can name it. */
  readonly instanceLabel?: string | undefined;
  /** Canonical address of that instance, which is operator configuration. */
  readonly baseUrl?: string | undefined;
}

export type TestitProjection = (
  data: unknown,
  context: TestitProjectionContext,
) => unknown;

/**
 * Response shaping per operation. A projection never invents a field upstream
 * did not send: Test IT tolerates version skew by adding properties, so a
 * missing key is dropped rather than defaulted into a claim.
 */
export const TESTIT_PROJECTIONS: Readonly<Record<string, TestitProjection>> =
  Object.freeze({
    "connection.get": (data, context) => {
      const items = itemsOf(data);
      const total = context.page?.total;
      return compact({
        apiGeneration: "v2",
        instance: context.instanceLabel,
        baseUrl: context.baseUrl,
        // Test IT API v2 exposes no endpoint for the token owner, so this answer
        // reports what the probe proved — the instance answers and the token may
        // read projects — and claims no identity.
        tokenOwner: undefined,
        canReadProjects: total === undefined ? items.length > 0 : true,
        projectsVisible: total ?? items.length,
      });
    },

    "projects.list": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.projects,
        context.flags,
      );
      const offset = listOffset(context.input["offset"]);
      const items = filterItems(
        itemsOf(data).map(projectSummary),
        context.input,
        ["name", "id"],
      );
      return paged(items, context.page, limit, offset);
    },

    "projects.get": (data) => {
      const source = recordOf(data);
      return compact({
        ...projectSummary(data),
        untrustedContent: contentOf({
          description: contentBlock(
            stringOf(source, "description"),
            TEXT_CHARS,
          ),
        }),
        workflowId: stringOf(source, "workflowId"),
        attributesScheme: arrayOf(source["attributesScheme"])
          .map(attributeSummary)
          .filter((item) => Object.keys(item).length > 0),
      });
    },

    "sections.list": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.sections,
        context.flags,
      );
      const offset = listOffset(context.input["offset"]);
      return paged(
        filterItems(itemsOf(data).map(sectionSummary), context.input, [
          "name",
          "id",
        ]),
        context.page,
        limit,
        offset,
      );
    },

    "workItems.list": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.workItems,
        context.flags,
      );
      const offset = listOffset(context.input["offset"]);
      const entityType = oneOf(
        context.input["entityType"],
        WORK_ITEM_ENTITY_TYPES,
        "entityType",
        32,
      );
      const state = oneOf(
        context.input["state"],
        WORK_ITEM_STATES,
        "state",
        32,
      );
      const priority = oneOf(
        context.input["priority"],
        WORK_ITEM_PRIORITIES,
        "priority",
        16,
      );
      const tag = optionalText(context.input["tag"], "tag", 1, 128);
      const items = filterItems(
        itemsOf(data).map(workItemSummary),
        context.input,
        ["name", "id"],
      )
        .filter(
          (item) =>
            entityType === undefined || item["entityTypeName"] === entityType,
        )
        .filter((item) => state === undefined || item["state"] === state)
        .filter(
          (item) => priority === undefined || item["priority"] === priority,
        )
        .filter((item) => {
          if (tag === undefined) return true;
          const names = item["tagNames"];
          return Array.isArray(names) && names.includes(tag);
        });
      return paged(items, context.page, limit, offset);
    },

    "workItems.get": (data) => workItemDetail(data),

    "workItems.history": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.history,
        context.flags,
      );
      const offset = listOffset(context.input["offset"]);
      return paged(
        itemsOf(data).map(historyEntry),
        context.page,
        limit,
        offset,
      );
    },

    "workItems.comments": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.comments,
        context.flags,
      );
      return capped(itemsOf(data).map(commentEntry), limit);
    },

    "workItems.testResults": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.testResults,
        context.flags,
      );
      const offset = listOffset(context.input["offset"]);
      const outcome = oneOf(
        context.input["outcome"],
        RESULT_OUTCOMES,
        "outcome",
        16,
      );
      const items = itemsOf(data)
        .map(testResultHistoryEntry)
        .filter((item) => outcome === undefined || item["outcome"] === outcome);
      return paged(items, context.page, limit, offset);
    },

    "testPlans.list": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.testPlans,
        context.flags,
      );
      return capped(
        filterItems(itemsOf(data).map(testPlanEntry), context.input, [
          "name",
          "id",
        ]),
        limit,
      );
    },

    "testPlans.get": (data) => {
      const source = recordOf(data);
      return compact({
        ...testPlanEntry(data),
        attributes: mapObject(source["attributes"], CONFIG_TEXT_CHARS),
      });
    },

    "testPlans.summary": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.testPlans,
        context.flags,
      );
      return capped(itemsOf(data).map(testPlanSummaryOf), limit);
    },

    "testRuns.list": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.testRuns,
        context.flags,
      );
      const offset = listOffset(context.input["offset"]);
      const items = filterItems(
        itemsOf(data).map(testRunSummary),
        context.input,
        ["name", "id"],
      );
      return paged(items, context.page, limit, offset);
    },

    "testRuns.get": (data) => testRunDetail(data),

    "testRuns.results": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.testResults,
        context.flags,
      );
      const outcome = oneOf(
        context.input["outcome"],
        RESULT_OUTCOMES,
        "outcome",
        16,
      );
      const items = itemsOf(data)
        .map(testPointResult)
        .filter(
          (item) =>
            outcome === undefined || item["aggregatedOutcome"] === outcome,
        );
      return capped(items, limit);
    },

    "testResults.get": (data) => testResultDetail(data),

    "testResults.attachments": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.attachments,
        context.flags,
      );
      return capped(itemsOf(data).map(attachmentSummary), limit);
    },

    "attachments.metadata": (data) => attachmentSummary(data),

    "autoTests.list": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.autoTests,
        context.flags,
      );
      const offset = listOffset(context.input["offset"]);
      const items = filterItems(
        itemsOf(data).map(autoTestSummary),
        context.input,
        ["name", "externalId", "classname", "namespace", "id"],
      );
      return paged(items, context.page, limit, offset);
    },

    "autoTests.get": (data) => autoTestDetail(data),

    "configurations.list": (data, context) => {
      const limit = listLimit(
        context.input["limit"],
        TESTIT_LIMITS.configurations,
        context.flags,
      );
      return capped(
        filterItems(itemsOf(data).map(configurationSummary), context.input, [
          "name",
          "id",
        ]),
        limit,
      );
    },
  });
