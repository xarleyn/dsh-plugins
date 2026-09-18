/**
 * `document_compare` — the deterministic comparison of two documents (§5, §6).
 *
 * The tool hands two references to the runtime and returns a summary, a
 * quality statement and a bounded preview. It deliberately does not return the
 * documents: the model receives changes that were computed, never the material
 * to compute them from. A comparison that cannot be made is an error with a
 * code, not an invitation to read both files and describe the difference.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { DocumentRuntime } from "../runtime.js";
import type { DocumentCompareResult } from "../comparison/types.js";
import {
  renderWarning,
  requireDocumentScope,
  type DocumentToolExec,
  warningsSchema,
} from "./shared.js";

export const DOCUMENT_COMPARE_TOOL = "document_compare";

const DESCRIPTION = [
  "Compare two documents structurally and deterministically, without reading them for the model.",
  "Accepts paths in the session workspace or ids of earlier document artifacts, and supports",
  "DOCX, Markdown, TXT and text-layer PDF. Returns a comparisonId, the change summary, the",
  "extraction quality and a short preview; read the rest with document_diff_read.",
  "This tool, not the model, decides what changed: do not describe differences it did not report.",
].join(" ");

const REFERENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: {
      type: "string",
      description:
        "Path of the document, relative to the session working directory.",
    },
    artifactId: {
      type: "string",
      description:
        "Id of an artifact created earlier in this session (its retained input, or its output).",
    },
  },
} as const;

const LOCATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    part: { type: "string" },
    nodeIndex: { type: "number" },
    headingPath: { type: "array", items: { type: "string" } },
    paragraph: { type: "number" },
    page: { type: "number" },
    table: { type: "number" },
    row: { type: "number" },
    column: { type: "number" },
    xmlPath: { type: "string" },
  },
} as const;

export const CHANGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", required: true },
    kind: { type: "string", required: true },
    nodeType: { type: "string", required: true },
    left: LOCATION_SCHEMA,
    right: LOCATION_SCHEMA,
    before: { type: "string" },
    after: { type: "string" },
    spans: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", required: true },
          text: { type: "string", required: true },
        },
      },
    },
    context: {
      type: "object",
      additionalProperties: false,
      required: true,
      properties: {
        headingPath: { type: "array", items: { type: "string" } },
        previous: { type: "string" },
        next: { type: "string" },
      },
    },
    signals: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
} as const;

export function createDocumentCompareTool(options: {
  readonly runtime: DocumentRuntime;
}) {
  return defineTool({
    name: DOCUMENT_COMPARE_TOOL,
    description: DESCRIPTION,
    parameters: {
      left: { ...REFERENCE_SCHEMA, required: true },
      right: { ...REFERENCE_SCHEMA, required: true },
      mode: {
        type: "string",
        enum: ["default", "contract"],
        description:
          "`contract` is the conservative preset: headers, footers and footnotes included, whitespace and formatting folded, everything that carries meaning kept.",
      },
      scope: {
        type: "string",
        enum: ["body", "all"],
        description:
          "`body` compares the document text only; `all` also compares headers, footers, footnotes and comments.",
      },
      options: {
        type: "object",
        additionalProperties: false,
        properties: {
          detectMoves: { type: "boolean" },
          includeHeaders: { type: "boolean" },
          includeFooters: { type: "boolean" },
          includeFootnotes: { type: "boolean" },
          includeComments: { type: "boolean" },
          ignoreWhitespace: { type: "boolean" },
          ignoreFormatting: { type: "boolean" },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          comparisonId: { type: "string", required: true },
          status: { type: "string", required: true },
          left: {
            type: "object",
            additionalProperties: false,
            required: true,
            properties: {
              name: { type: "string", required: true },
              sha256: { type: "string", required: true },
              format: { type: "string", required: true },
              nodes: { type: "number", required: true },
            },
          },
          right: {
            type: "object",
            additionalProperties: false,
            required: true,
            properties: {
              name: { type: "string", required: true },
              sha256: { type: "string", required: true },
              format: { type: "string", required: true },
              nodes: { type: "number", required: true },
            },
          },
          quality: {
            type: "object",
            additionalProperties: false,
            required: true,
            properties: {
              level: { type: "string", required: true },
              leftExtraction: { type: "string", required: true },
              rightExtraction: { type: "string", required: true },
              ocrUsed: { type: "boolean", required: true },
              reasons: { type: "array", items: { type: "string" } },
            },
          },
          summary: {
            type: "object",
            additionalProperties: false,
            required: true,
            properties: {
              insertions: { type: "number", required: true },
              deletions: { type: "number", required: true },
              replacements: { type: "number", required: true },
              moves: { type: "number", required: true },
              affectedSections: { type: "number", required: true },
              total: { type: "number", required: true },
            },
          },
          preview: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                changeId: { type: "string", required: true },
                kind: { type: "string", required: true },
                location: { type: "string", required: true },
                before: { type: "string", required: true },
                after: { type: "string", required: true },
                signals: { type: "array", items: { type: "string" } },
              },
            },
          },
          previewTruncated: { type: "boolean", required: true },
          changesPath: { type: "string", required: true },
          reportPath: { type: "string", required: true },
          manifestPath: { type: "string", required: true },
          warnings: warningsSchema,
        },
      },
      render: (_args: unknown, value: unknown) => {
        const result = value as DocumentCompareResult;
        return [
          {
            type: "text" as const,
            text: [
              `comparison ${result.comparisonId}: ${result.summary.total} changes`,
              `${result.left.name} (${result.left.format}, ${result.left.nodes} nodes) ↔ ${result.right.name} (${result.right.format}, ${result.right.nodes} nodes)`,
              `quality: ${result.quality.level}${
                result.quality.reasons.length === 0
                  ? ""
                  : ` (${result.quality.reasons.join("; ")})`
              }`,
              `insertions ${result.summary.insertions}, deletions ${result.summary.deletions}, replacements ${result.summary.replacements}, moves ${result.summary.moves}, sections ${result.summary.affectedSections}`,
              ...result.preview.map((entry) =>
                [
                  `${entry.changeId} ${entry.kind} @ ${entry.location}`,
                  ...(entry.before === ""
                    ? []
                    : [`  - ${oneLine(entry.before)}`]),
                  ...(entry.after === ""
                    ? []
                    : [`  + ${oneLine(entry.after)}`]),
                ].join("\n"),
              ),
              ...(result.previewTruncated
                ? [
                    `the preview shows ${result.preview.length} of ${result.summary.total} changes; read the rest with document_diff_read`,
                  ]
                : []),
              ...result.warnings.map(renderWarning),
            ].join("\n"),
          },
        ];
      },
    },
    timeoutMs: 600_000,
    async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
      const result = await options.runtime.compare(
        args as unknown as Parameters<DocumentRuntime["compare"]>[0],
        requireDocumentScope(exec),
      );
      return {
        comparisonId: result.comparisonId,
        status: result.status,
        left: { ...result.left },
        right: { ...result.right },
        quality: {
          level: result.quality.level,
          leftExtraction: result.quality.leftExtraction,
          rightExtraction: result.quality.rightExtraction,
          ocrUsed: result.quality.ocrUsed,
          reasons: [...result.quality.reasons],
        },
        summary: { ...result.summary },
        preview: result.preview.map((entry) => ({
          changeId: entry.changeId,
          kind: entry.kind,
          location: entry.location,
          before: entry.before,
          after: entry.after,
          signals: [...entry.signals],
        })),
        previewTruncated: result.previewTruncated,
        changesPath: result.changesPath,
        reportPath: result.reportPath,
        manifestPath: result.manifestPath,
        // The tool result carries code, message and backend; the diagnostic
        // `details` stay in the manifest, where an operator reads them.
        warnings: result.warnings.map((warning) => ({
          code: warning.code,
          message: warning.message,
          ...(warning.backend === undefined
            ? {}
            : { backend: warning.backend }),
        })),
      };
    },
  });
}

function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  return collapsed.length > 200 ? `${collapsed.slice(0, 200)}…` : collapsed;
}
