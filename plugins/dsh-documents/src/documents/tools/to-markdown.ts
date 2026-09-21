/**
 * `document_to_markdown` — DOCX/PDF to Markdown (§9, §34).
 *
 * The model gets the extracted text and a path to the full copy; the artifact
 * bundle keeps the input, the extracted Markdown and any extracted images.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { DocumentRuntime } from "../runtime.js";
import type { DocumentToMarkdownResult } from "../types.js";
import {
  fileParameter,
  renderWarning,
  requireDocumentScope,
  toolWarnings,
  type DocumentToolExec,
  type DocumentToolOptions,
  warningsSchema,
} from "./shared.js";

export const DOCUMENT_TO_MARKDOWN_TOOL = "document_to_markdown";

const DESCRIPTION = [
  "Extract a DOCX or PDF into Markdown.",
  "Supports structured extraction, tables and images, and applies OCR when the document has no text layer.",
  "Returns the Markdown plus the path of the extracted file inside its artifact bundle.",
].join(" ");

export function createDocumentToMarkdownTool(options: DocumentToolOptions) {
  return defineTool({
    name: DOCUMENT_TO_MARKDOWN_TOOL,
    description: DESCRIPTION,
    parameters: {
      file: fileParameter(),
      mode: {
        type: "string",
        enum: ["auto", "fast", "accurate"] as const,
        description:
          "Extraction route. `accurate` (default) uses the layout-aware extractor; `fast` prefers the light extractor when the deployment enables one.",
      },
      ocr: {
        type: "string",
        enum: ["auto", "off", "force"] as const,
        description:
          "OCR policy: `auto` lets the extractor decide per page, `off` never runs OCR, `force` always runs it.",
      },
      ocrLanguages: {
        type: "array",
        items: { type: "string" },
        description: 'OCR languages, e.g. ["rus", "eng"].',
      },
      extractImages: {
        type: "boolean",
        description:
          "Write extracted images into the bundle's assets directory.",
      },
      extractTables: {
        type: "boolean",
        description: "Use the accurate table extraction mode.",
      },
      preservePageMarkers: {
        type: "boolean",
        description:
          "Keep page boundaries in the extracted Markdown where the extractor reports them.",
      },
      outputFilename: {
        type: "string",
        description:
          "Name of the extracted Markdown file inside the artifact bundle.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          artifactId: { type: "string", required: true },
          markdown: { type: "string", required: true },
          markdownPath: { type: "string", required: true },
          assets: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                path: { type: "string", required: true },
                mediaType: { type: "string", required: true },
              },
            },
          },
          pages: { type: "number" },
          backend: { type: "string", required: true },
          warnings: warningsSchema,
          manifestPath: { type: "string", required: true },
        },
      },
      render: (_args: unknown, value: unknown) => {
        const result = value as DocumentToMarkdownResult;
        return [
          {
            type: "text" as const,
            text: [
              `artifact: ${result.artifactId} (extracted by ${result.backend})`,
              ...(result.pages === undefined ? [] : [`pages: ${result.pages}`]),
              `markdown: ${result.markdownPath}`,
              ...(result.assets === undefined
                ? []
                : [
                    `assets: ${result.assets.map((asset) => asset.path).join(", ")}`,
                  ]),
              ...result.warnings.map(renderWarning),
              "---",
              result.markdown,
            ].join("\n"),
          },
        ];
      },
    },
    timeoutMs:
      options.runtime.config.docling.timeoutMs +
      options.runtime.config.markitdown.timeoutMs +
      30_000,
    async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
      const result = await options.runtime.toMarkdown(
        args as unknown as Parameters<DocumentRuntime["toMarkdown"]>[0],
        requireDocumentScope(exec, options),
      );
      return {
        artifactId: result.artifactId,
        markdown: result.markdown,
        markdownPath: result.markdownPath,
        ...(result.assets === undefined
          ? {}
          : {
              assets: result.assets.map((asset) => ({
                path: asset.path,
                mediaType: asset.mediaType,
              })),
            }),
        ...(result.pages === undefined ? {} : { pages: result.pages }),
        backend: result.backend,
        warnings: toolWarnings(result.warnings),
        manifestPath: result.manifestPath,
      };
    },
  });
}
