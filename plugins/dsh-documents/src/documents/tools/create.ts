/**
 * `document_create` — Markdown to DOCX and/or PDF (§8, §34).
 *
 * This is the tool the agent reaches for instead of driving pandoc and
 * LibreOffice itself, which is the whole point of the pipeline: the intent is
 * "give me this report as a Word file and a PDF", and the service decides how
 * that happens.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { DocumentRuntime } from "../runtime.js";
import type { DocumentCreateResult } from "../types.js";
import {
  ARTIFACT_NOTE,
  renderFiles,
  renderWarning,
  requireDocumentScope,
  toolFiles,
  toolWarnings,
  type DocumentToolExec,
  type DocumentToolOptions,
  warningsSchema,
} from "./shared.js";

export const DOCUMENT_CREATE_TOOL = "document_create";

const DESCRIPTION = [
  "Create DOCX and/or PDF documents from Markdown content using the managed document pipeline and its templates.",
  "Use this instead of invoking document conversion binaries directly: it writes an artifact bundle with the source, the assets and a manifest, and it returns the created file paths.",
  "Assets referenced by the Markdown must be supplied through `assets`; remote images are never fetched.",
].join(" ");

export function createDocumentCreateTool(options: DocumentToolOptions) {
  return defineTool({
    name: DOCUMENT_CREATE_TOOL,
    description: DESCRIPTION,
    parameters: {
      content: {
        type: "string",
        required: true,
        description: "Markdown source of the document.",
      },
      formats: {
        type: "array",
        required: true,
        items: { type: "string", enum: ["docx", "pdf"] as const },
        description:
          "Formats to produce. DOCX + PDF renders one document and exports both.",
      },
      filename: {
        type: "string",
        description:
          "File name for the outputs, without a directory. Sanitized before use; defaults to document-<artifact id>.",
      },
      template: {
        type: "string",
        description:
          "Registered template name for the layout (for example qa-report). A name that is not registered fails; there is no silent fallback.",
      },
      title: {
        type: "string",
        description:
          "Document title; falls back to the `title` front-matter field.",
      },
      metadata: {
        type: "object",
        additionalProperties: true,
        description:
          "Additional document properties, as string key/value pairs.",
      },
      assets: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: {
              type: "string",
              required: true,
              description: "Stable asset id.",
            },
            path: {
              type: "string",
              description:
                "Path of an existing file inside the session workspace.",
            },
            dataRef: {
              type: "string",
              description: "Inline asset content as a base64 data URI.",
            },
            filename: {
              type: "string",
              description: "Name to store the asset under.",
            },
            mimeType: {
              type: "string",
              description: "Media type, e.g. image/png.",
            },
          },
        },
        description:
          "Images and other assets the Markdown references, as a path or a data URI (exactly one of the two).",
      },
      options: {
        type: "object",
        additionalProperties: false,
        properties: {
          pdfMode: {
            type: "string",
            enum: ["auto", "office", "typst"] as const,
            description:
              "PDF route. `office` renders DOCX first (identical layout to the Word file); `typst` renders directly when the deployment enables it.",
          },
          pageSize: {
            type: "string",
            description: "Page size such as A4 or Letter.",
          },
          locale: {
            type: "string",
            description: "Document language, e.g. ru-RU.",
          },
          toc: { type: "boolean", description: "Insert a table of contents." },
          preserveSource: {
            type: "boolean",
            description: "Keep the Markdown source inside the artifact bundle.",
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
          source: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: { type: "string", required: true },
              mediaType: { type: "string", required: true },
            },
          },
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
          template: { type: "string" },
          warnings: warningsSchema,
          manifestPath: { type: "string", required: true },
        },
      },
      render: (_args: unknown, value: unknown) => {
        const result = value as DocumentCreateResult;
        return [
          {
            type: "text" as const,
            text: [
              `artifact: ${result.artifactId}`,
              ...renderFiles(result.files),
              ...(result.template === undefined
                ? []
                : [`template: ${result.template}`]),
              ...(result.source === undefined
                ? []
                : [`source: ${result.source.path}`]),
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
      30_000,
    async execute(args: Record<string, unknown>, exec: DocumentToolExec) {
      const result = await options.runtime.create(
        args as unknown as Parameters<DocumentRuntime["create"]>[0],
        requireDocumentScope(exec, options),
      );
      return {
        artifactId: result.artifactId,
        ...(result.source === undefined
          ? {}
          : {
              source: {
                path: result.source.path,
                mediaType: result.source.mediaType,
              },
            }),
        files: toolFiles(result.files),
        ...(result.template === undefined ? {} : { template: result.template }),
        warnings: toolWarnings(result.warnings),
        manifestPath: result.manifestPath,
      };
    },
  });
}
