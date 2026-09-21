/**
 * `document_diff_read` — paging through a change set (§7).
 *
 * A comparison of two long contracts is thousands of changes; one of them is a
 * tool result, and the rest are a file. This tool reads that file a page at a
 * time, with a filter on top, so a follow-up question ("the money changes in
 * section 5") costs one call and no re-parsing of either document.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { DocumentRuntime } from "../runtime.js";
import {
  CHANGE_KINDS,
  CHANGE_SIGNALS,
  SIGNAL_FILTER_VALUES,
  type DocumentChange,
  type DocumentDiffReadResult,
} from "../comparison/types.js";
import { CHANGE_SCHEMA } from "./compare.js";
import {
  requireDocumentScope,
  type DocumentToolExec,
  type DocumentToolOptions,
} from "./shared.js";

export const DOCUMENT_DIFF_READ_TOOL = "document_diff_read";

const DESCRIPTION = [
  "Read changes from a comparison created by document_compare, a page at a time.",
  "Filter by section (a substring of the heading path), by change kind, or by signal",
  `(${CHANGE_SIGNALS.join(", ")}, or a short family name such as money, deadline, obligation).`,
  "Every conclusion about a difference must cite a changeId from this tool.",
].join(" ");

/** The tool result shape of one change, mirroring the declared schema. */
export interface ChangeOutput {
  id: string;
  kind: string;
  nodeType: string;
  left?: LocationOutput;
  right?: LocationOutput;
  before?: string;
  after?: string;
  spans?: { kind: string; text: string }[];
  context: { headingPath?: string[]; previous?: string; next?: string };
  signals: string[];
  confidence: number;
}

export interface LocationOutput {
  part: string;
  nodeIndex: number;
  headingPath: string[];
  paragraph?: number;
  page?: number;
  table?: number;
  row?: number;
  column?: number;
  xmlPath?: string;
}

function changeShape(change: DocumentChange): ChangeOutput {
  return {
    id: change.id,
    kind: change.kind,
    nodeType: change.nodeType,
    ...(change.left === undefined ? {} : { left: locationShape(change.left) }),
    ...(change.right === undefined
      ? {}
      : { right: locationShape(change.right) }),
    ...(change.before === undefined ? {} : { before: change.before }),
    ...(change.after === undefined ? {} : { after: change.after }),
    ...(change.spans === undefined
      ? {}
      : {
          spans: change.spans.map((span) => ({
            kind: span.kind,
            text: span.text,
          })),
        }),
    context: {
      headingPath: [...change.context.headingPath],
      ...(change.context.previous === undefined
        ? {}
        : { previous: change.context.previous }),
      ...(change.context.next === undefined
        ? {}
        : { next: change.context.next }),
    },
    signals: [...change.signals],
    confidence: change.confidence,
  };
}

function locationShape(location: {
  readonly part: string;
  readonly nodeIndex: number;
  readonly headingPath: readonly string[];
  readonly paragraph?: number;
  readonly page?: number;
  readonly table?: number;
  readonly row?: number;
  readonly column?: number;
  readonly xmlPath?: string;
}): LocationOutput {
  return {
    part: location.part,
    nodeIndex: location.nodeIndex,
    headingPath: [...location.headingPath],
    ...(location.paragraph === undefined
      ? {}
      : { paragraph: location.paragraph }),
    ...(location.page === undefined ? {} : { page: location.page }),
    ...(location.table === undefined ? {} : { table: location.table }),
    ...(location.row === undefined ? {} : { row: location.row }),
    ...(location.column === undefined ? {} : { column: location.column }),
    ...(location.xmlPath === undefined ? {} : { xmlPath: location.xmlPath }),
  };
}

export function createDocumentDiffReadTool(options: DocumentToolOptions) {
  return defineTool({
    name: DOCUMENT_DIFF_READ_TOOL,
    description: DESCRIPTION,
    parameters: {
      comparisonId: {
        type: "string",
        required: true,
        description: "The comparisonId returned by document_compare.",
      },
      cursor: {
        type: "string",
        description: "nextCursor from the previous page; omit for the first.",
      },
      limit: {
        type: "number",
        description: "Changes per page; the deployment caps it.",
      },
      filters: {
        type: "object",
        additionalProperties: false,
        properties: {
          section: {
            type: "string",
            description: "Substring of the heading path, case-insensitive.",
          },
          kinds: {
            type: "array",
            items: { type: "string", enum: CHANGE_KINDS },
          },
          signals: {
            type: "array",
            items: { type: "string", enum: SIGNAL_FILTER_VALUES },
          },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          comparisonId: { type: "string", required: true },
          changes: { type: "array", required: true, items: CHANGE_SCHEMA },
          nextCursor: { type: "string" },
          remaining: { type: "number", required: true },
          total: { type: "number", required: true },
          returned: { type: "number", required: true },
        },
      },
      render: (_args: unknown, value: unknown) => {
        const result = value as DocumentDiffReadResult;
        const lines: string[] = [
          `${result.returned} changes of ${result.total} (${result.remaining} remaining)`,
        ];
        for (const change of result.changes) {
          lines.push(`${change.id} ${change.kind} [${change.nodeType}]`);
          if (change.before !== undefined) lines.push(`  - ${change.before}`);
          if (change.after !== undefined) lines.push(`  + ${change.after}`);
          if (change.signals.length > 0) {
            lines.push(`  signals: ${change.signals.join(", ")}`);
          }
        }
        if (result.nextCursor !== undefined) {
          lines.push(`nextCursor: ${result.nextCursor}`);
        }
        return [{ type: "text" as const, text: lines.join("\n") }];
      },
    },
    timeoutMs: 60_000,
    async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
      const result = await options.runtime.readDiff(
        args as unknown as Parameters<DocumentRuntime["readDiff"]>[0],
        requireDocumentScope(exec, options),
      );
      return {
        comparisonId: result.comparisonId,
        changes: result.changes.map(changeShape),
        ...(result.nextCursor === undefined
          ? {}
          : { nextCursor: result.nextCursor }),
        remaining: result.remaining,
        total: result.total,
        returned: result.returned,
      };
    },
  });
}
