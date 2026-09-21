/**
 * `document_inspect` — what a document is, without converting it (§11, §34).
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { DocumentRuntime } from "../runtime.js";
import type { DocumentInspectResult } from "../types.js";
import {
  fileParameter,
  formatBytes,
  renderWarning,
  requireDocumentScope,
  toolWarnings,
  type DocumentToolExec,
  type DocumentToolOptions,
  warningsSchema,
} from "./shared.js";

export const DOCUMENT_INSPECT_TOOL = "document_inspect";

const DESCRIPTION = [
  "Inspect document type, metadata and basic structure without converting it.",
  "Reports the detected format, size, hash, document properties, page/heading/table/image counts and whether the file is encrypted or macro-enabled.",
].join(" ");

function structureLines(value: DocumentInspectResult): string[] {
  const structure = value.structure;
  if (structure === undefined) return [];
  return Object.entries(structure)
    .filter(([, count]) => typeof count === "number")
    .map(([name, count]) => `${name}: ${String(count)}`);
}

export function createDocumentInspectTool(options: DocumentToolOptions) {
  return defineTool({
    name: DOCUMENT_INSPECT_TOOL,
    description: DESCRIPTION,
    parameters: { file: fileParameter() },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          filename: { type: "string", required: true },
          format: { type: "string", required: true },
          mediaType: { type: "string", required: true },
          size: { type: "number", required: true },
          sha256: { type: "string", required: true },
          metadata: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              author: { type: "string" },
              createdAt: { type: "string" },
              modifiedAt: { type: "string" },
            },
          },
          structure: {
            type: "object",
            additionalProperties: false,
            properties: {
              pages: { type: "number" },
              headings: { type: "number" },
              tables: { type: "number" },
              images: { type: "number" },
            },
          },
          encrypted: { type: "boolean" },
          macroEnabled: { type: "boolean" },
          warnings: warningsSchema,
        },
      },
      render: (_args: unknown, value: unknown) => {
        const result = value as DocumentInspectResult;
        return [
          {
            type: "text" as const,
            text: [
              `${result.filename}: ${result.format} (${result.mediaType})`,
              `size: ${formatBytes(result.size)}, sha256: ${result.sha256}`,
              ...(result.encrypted === true ? ["encrypted: yes"] : []),
              ...(result.macroEnabled === true ? ["macro-enabled: yes"] : []),
              ...(result.metadata === undefined
                ? []
                : Object.entries(result.metadata).map(
                    ([key, entry]) => `${key}: ${entry}`,
                  )),
              ...structureLines(result),
              ...result.warnings.map(renderWarning),
            ].join("\n"),
          },
        ];
      },
    },
    timeoutMs: 30_000,
    async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
      const result = await options.runtime.inspect(
        args as unknown as Parameters<DocumentRuntime["inspect"]>[0],
        requireDocumentScope(exec, options),
      );
      return {
        filename: result.filename,
        format: result.format,
        mediaType: result.mediaType,
        size: result.size,
        sha256: result.sha256,
        ...(result.metadata === undefined
          ? {}
          : {
              metadata: {
                ...(result.metadata.title === undefined
                  ? {}
                  : { title: result.metadata.title }),
                ...(result.metadata.author === undefined
                  ? {}
                  : { author: result.metadata.author }),
                ...(result.metadata.createdAt === undefined
                  ? {}
                  : { createdAt: result.metadata.createdAt }),
                ...(result.metadata.modifiedAt === undefined
                  ? {}
                  : { modifiedAt: result.metadata.modifiedAt }),
              },
            }),
        ...(result.structure === undefined
          ? {}
          : {
              structure: {
                ...(result.structure.pages === undefined
                  ? {}
                  : { pages: result.structure.pages }),
                ...(result.structure.headings === undefined
                  ? {}
                  : { headings: result.structure.headings }),
                ...(result.structure.tables === undefined
                  ? {}
                  : { tables: result.structure.tables }),
                ...(result.structure.images === undefined
                  ? {}
                  : { images: result.structure.images }),
              },
            }),
        ...(result.encrypted === undefined
          ? {}
          : { encrypted: result.encrypted }),
        ...(result.macroEnabled === undefined
          ? {}
          : { macroEnabled: result.macroEnabled }),
        warnings: toolWarnings(result.warnings),
      };
    },
  });
}
