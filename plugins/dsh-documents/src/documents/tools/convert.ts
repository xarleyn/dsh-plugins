/**
 * `document_convert` — one supported format to another (§10, §34).
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { DocumentRuntime } from "../runtime.js";
import { CONVERSION_ROUTES } from "../orchestrator/convert-document.js";
import type { DocumentConvertResult } from "../types.js";
import {
  ARTIFACT_NOTE,
  fileParameter,
  renderFiles,
  renderWarning,
  requireDocumentScope,
  toolFiles,
  toolWarnings,
  type DocumentToolExec,
  type DocumentToolOptions,
  warningsSchema,
} from "./shared.js";

export const DOCUMENT_CONVERT_TOOL = "document_convert";

function describeRoutes(): string {
  return CONVERSION_ROUTES.map(([from, to]) => `${from} → ${to}`).join(", ");
}

export function createDocumentConvertTool(options: DocumentToolOptions) {
  return defineTool({
    name: DOCUMENT_CONVERT_TOOL,
    description: [
      "Convert a supported document to another supported document format using the managed document pipeline.",
      `Supported routes: ${describeRoutes()}.`,
      "Markdown targets extract the text; DOCX → PDF keeps the Word layout. Anything else is refused instead of being attempted.",
    ].join(" "),
    parameters: {
      file: fileParameter(),
      targetFormat: {
        type: "string",
        required: true,
        enum: ["docx", "pdf", "md"] as const,
        description: "Format to produce.",
      },
      template: {
        type: "string",
        description: "Template name, for Markdown → DOCX/PDF conversions.",
      },
      filename: {
        type: "string",
        description: "File name of the produced document, without a directory.",
      },
      outputFilename: {
        type: "string",
        description:
          "Name of the extracted Markdown file when the target is md.",
      },
      options: {
        type: "object",
        additionalProperties: false,
        properties: {
          pdfMode: {
            type: "string",
            enum: ["auto", "office", "typst"] as const,
            description: "PDF route for Markdown → PDF.",
          },
          ocr: {
            type: "string",
            enum: ["auto", "off", "force"] as const,
            description: "OCR policy for conversions into Markdown.",
          },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          artifactId: { type: "string", required: true },
          files: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                format: { type: "string", required: true },
                path: { type: "string", required: true },
                mediaType: { type: "string", required: true },
                size: { type: "number", required: true },
                sha256: { type: "string", required: true },
                status: { type: "string", required: true },
                error: { type: "string" },
              },
            },
          },
          source: {
            type: "object",
            required: true,
            additionalProperties: false,
            properties: {
              path: { type: "string", required: true },
              format: { type: "string", required: true },
            },
          },
          warnings: warningsSchema,
          manifestPath: { type: "string", required: true },
        },
      },
      render: (_args: unknown, value: unknown) => {
        const result = value as DocumentConvertResult;
        return [
          {
            type: "text" as const,
            text: [
              `artifact: ${result.artifactId}`,
              `source: ${result.source.path} (${result.source.format})`,
              ...renderFiles(result.files),
              ...result.warnings.map(renderWarning),
              `manifest: ${result.manifestPath}`,
              ARTIFACT_NOTE,
            ].join("\n"),
          },
        ];
      },
    },
    timeoutMs:
      options.runtime.config.pandoc.timeoutMs +
      options.runtime.config.libreoffice.timeoutMs +
      options.runtime.config.docling.timeoutMs +
      30_000,
    async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
      const result = await options.runtime.convert(
        args as unknown as Parameters<DocumentRuntime["convert"]>[0],
        requireDocumentScope(exec, options),
      );
      return {
        artifactId: result.artifactId,
        files: toolFiles(result.files),
        source: { path: result.source.path, format: result.source.format },
        warnings: toolWarnings(result.warnings),
        manifestPath: result.manifestPath,
      };
    },
  });
}
