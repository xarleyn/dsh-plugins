/**
 * `dsh_lightrag_documents` — what the knowledge base holds and how far the
 * ingestion pipeline has got with each document.
 *
 * The listing is bounded by `documents.maxListed`; the plugin walks the
 * server's pagination itself, so the model asks once and gets one answer.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { LightRagStatusCount } from "../client.js";
import {
  logCall,
  optionalInteger,
  optionalText,
  SERVICE_NOTE,
  UNTRUSTED_NOTE,
  type LightRagToolDeps,
} from "./shared.js";

export interface LightRagDocumentEntry {
  readonly id: string;
  readonly filePath: string;
  readonly status: string;
  readonly chunksCount: number;
  readonly contentLength: number;
  readonly updatedAt: string;
  readonly errorMessage: string;
}

export interface LightRagDocumentsResult {
  /** Array mutability follows the output schema's inferred type. */
  readonly documents: LightRagDocumentEntry[];
  readonly count: number;
  /** Documents matching the filter, across every page — not just this result. */
  readonly totalCount: number;
  /** True when the server holds more matches than this result carries. */
  readonly truncated: boolean;
  /** Counts for the whole knowledge base, not just the filtered set. */
  readonly statusCounts: LightRagStatusCount[];
}

export function createLightRagDocumentsTool(deps: LightRagToolDeps) {
  const client = deps.clientOverride ?? deps.client;
  return defineTool({
    name: "dsh_lightrag_documents",
    description: [
      "List the documents indexed in this deployment's LightRAG knowledge base with their ingestion status, chunk count and size.",
      "Use it to see whether a corpus file has been ingested at all, to find the id of a document (needed to delete one), or to check why the index looks empty.",
      "Optionally filter by status; statusCounts always describes the whole knowledge base, so a filtered listing still shows what else is there.",
      `Read-only. ${SERVICE_NOTE} ${UNTRUSTED_NOTE}`,
    ].join(" "),
    parameters: {
      status: {
        type: "string",
        description:
          "Only list documents in this ingestion status: pending, parsing, analyzing, processing, processed or failed. An unknown value is rejected by the server.",
      },
      limit: {
        type: "integer",
        description:
          "Maximum documents to return (1-1000). Default: the deployment's value.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          documents: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: {
                  type: "string",
                  required: true,
                  description: "Server-assigned document id.",
                },
                filePath: {
                  type: "string",
                  required: true,
                  description: "Path of the source document.",
                },
                status: {
                  type: "string",
                  required: true,
                  description: "Ingestion status of this document.",
                },
                chunksCount: {
                  type: "integer",
                  required: true,
                  description:
                    "Chunks the document was split into; 0 if unknown.",
                },
                contentLength: {
                  type: "integer",
                  required: true,
                  description: "Content length in characters.",
                },
                updatedAt: {
                  type: "string",
                  required: true,
                  description: "Last update timestamp.",
                },
                errorMessage: {
                  type: "string",
                  required: true,
                  description:
                    "Failure reason for a failed document; empty otherwise.",
                },
              },
            },
          },
          count: { type: "integer", required: true },
          totalCount: {
            type: "integer",
            required: true,
            description: "Matches across all pages of the server's listing.",
          },
          truncated: { type: "boolean", required: true },
          statusCounts: {
            type: "array",
            required: true,
            description:
              "Document count per status for the whole knowledge base.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                status: { type: "string", required: true },
                count: { type: "integer", required: true },
              },
            },
          },
        },
      },
      render: (_args, value: LightRagDocumentsResult) => [
        {
          type: "text",
          text: [
            `${value.count} of ${value.totalCount} document(s)${
              value.truncated ? " (truncated — raise limit for more)" : ""
            }`,
            `statuses: ${
              value.statusCounts
                .map((entry) => `${entry.status}=${entry.count}`)
                .join(", ") || "none"
            }`,
            ...value.documents.map(
              (document) =>
                `${document.id} ${document.status} ${document.filePath} (${document.chunksCount} chunks, ${document.contentLength} chars, updated ${document.updatedAt})${
                  document.errorMessage === ""
                    ? ""
                    : ` — ${document.errorMessage}`
                }`,
            ),
          ].join("\n"),
        },
      ],
    },
    async execute(args, exec) {
      const started = Date.now();
      const config = deps.config;
      const status = optionalText(args.status, "status");
      const limit = optionalInteger(
        args.limit,
        "limit",
        1,
        1_000,
        config.documentsMaxListed,
      );

      const page = await client.documents(
        { status, limit },
        { signal: exec.signal },
      );
      const result: LightRagDocumentsResult = {
        documents: page.documents.map((document) => ({
          id: document.id,
          filePath: document.filePath,
          status: document.status,
          chunksCount: document.chunksCount,
          contentLength: document.contentLength,
          updatedAt: document.updatedAt,
          errorMessage: document.errorMessage,
        })),
        count: page.documents.length,
        totalCount: page.totalCount,
        truncated: page.hasMore,
        statusCounts: [...page.statusCounts],
      };
      logCall(deps, "dsh_lightrag_documents", started, {
        status: status ?? "",
        limit,
        count: result.count,
        totalCount: result.totalCount,
        truncated: result.truncated,
      });
      return result;
    },
  });
}
