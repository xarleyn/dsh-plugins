/**
 * `document_from_url` — an online source (a wiki attachment, a text document
 * behind an authenticated provider) stored as a document artifact (§9, §34).
 *
 * Retrieval belongs to the web layer: the tool asks the deployment's fetch
 * provider for the URL, so its rules, credentials, address policy and size caps
 * decide what may be read. What this tool adds is a place for what came back —
 * a bundle with the text and a manifest naming the source URL — which the
 * model can then convert, quote from, or hand to an operator.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { DocumentRuntime } from "../runtime.js";
import type { DocumentFromUrlResult } from "../types.js";
import {
  renderWarning,
  requireDocumentScope,
  toolWarnings,
  warningsSchema,
  type DocumentToolExec,
} from "./shared.js";

export const DOCUMENT_FROM_URL_TOOL = "document_from_url";

const DESCRIPTION = [
  "Fetch an online document or attachment by URL and store it as a Markdown artifact in the session.",
  "Retrieval goes through the configured web provider, so the deployment's fetch rules and credentials apply;",
  "an unsupported format is answered with the reason instead of a stored file.",
  "The artifact keeps the fetched text and a manifest naming the source URL.",
].join(" ");

export function createDocumentFromUrlTool(options: {
  readonly runtime: DocumentRuntime;
}) {
  return defineTool({
    name: DOCUMENT_FROM_URL_TOOL,
    description: DESCRIPTION,
    parameters: {
      url: {
        type: "string",
        required: true,
        description:
          "Absolute http(s) URL of the source. The deployment's fetch provider must have a rule for it.",
      },
      outputFilename: {
        type: "string",
        description:
          "Name of the stored Markdown inside the artifact bundle. Defaults to source.md.",
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
          sourceUrl: { type: "string", required: true },
          truncated: { type: "boolean", required: true },
          backend: { type: "string", required: true },
          warnings: warningsSchema,
          manifestPath: { type: "string", required: true },
        },
      },
      render: (_args: unknown, value: unknown) => {
        const result = value as DocumentFromUrlResult;
        return [
          {
            type: "text" as const,
            text: [
              `source: ${result.sourceUrl} (via ${result.backend})`,
              `artifact: ${result.artifactId}`,
              `markdown: ${result.markdownPath}`,
              ...(result.truncated
                ? ["truncated: the stored text is capped"]
                : []),
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
      const result = await options.runtime.fromUrl(
        args as unknown as Parameters<DocumentRuntime["fromUrl"]>[0],
        requireDocumentScope(exec),
      );
      return {
        artifactId: result.artifactId,
        markdown: result.markdown,
        markdownPath: result.markdownPath,
        sourceUrl: result.sourceUrl,
        truncated: result.truncated,
        backend: result.backend,
        warnings: toolWarnings(result.warnings),
        manifestPath: result.manifestPath,
      };
    },
  });
}
