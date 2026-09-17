/**
 * `dsh_lightrag_status` — is the knowledge base healthy, and how much does it
 * hold? This is the first call to make when the index looks empty: it separates
 * "the server is down" from "nothing has been ingested yet".
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { LightRagStatusCount } from "../client.js";
import {
  logCall,
  SERVICE_NOTE,
  UNTRUSTED_NOTE,
  type LightRagToolDeps,
} from "./shared.js";

export interface LightRagStatusResult {
  readonly status: string;
  readonly coreVersion: string;
  readonly apiVersion: string;
  readonly authMode: string;
  readonly pipelineBusy: boolean;
  /** Array mutability follows the output schema's inferred type. */
  readonly statusCounts: LightRagStatusCount[];
}

export function createLightRagStatusTool(deps: LightRagToolDeps) {
  const client = deps.clientOverride ?? deps.client;
  return defineTool({
    name: "dsh_lightrag_status",
    description: [
      "Report the LightRAG server's health, its version, whether the ingestion pipeline is busy, and how many documents each status holds.",
      "Use it before concluding that the knowledge base is empty: it distinguishes an unreachable or unauthenticated server from an index with no documents in it.",
      `Read-only. ${SERVICE_NOTE} ${UNTRUSTED_NOTE}`,
    ].join(" "),
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: {
            type: "string",
            required: true,
            description: "Server health as the server reports it.",
          },
          coreVersion: { type: "string", required: true },
          apiVersion: { type: "string", required: true },
          authMode: {
            type: "string",
            required: true,
            description:
              "Whether the server enforces an API key (disabled means it does not).",
          },
          pipelineBusy: {
            type: "boolean",
            required: true,
            description: "Whether an ingestion run is in progress.",
          },
          statusCounts: {
            type: "array",
            required: true,
            description: "Document count per ingestion status.",
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
      render: (_args, value: LightRagStatusResult) => [
        {
          type: "text",
          text: [
            `LightRAG ${value.status} — core ${value.coreVersion}, api ${value.apiVersion}, auth ${value.authMode}, pipeline ${value.pipelineBusy ? "busy" : "idle"}`,
            `documents: ${
              value.statusCounts
                .map((entry) => `${entry.status}=${entry.count}`)
                .join(", ") || "none reported"
            }`,
          ].join("\n"),
        },
      ],
    },
    async execute(_args, exec) {
      const started = Date.now();
      const [health, statusCounts] = await Promise.all([
        client.health({ signal: exec.signal }),
        client.statusCounts({ signal: exec.signal }),
      ]);
      const result: LightRagStatusResult = {
        status: health.status,
        coreVersion: health.coreVersion,
        apiVersion: health.apiVersion,
        authMode: health.authMode,
        pipelineBusy: health.pipelineBusy,
        statusCounts: [...statusCounts],
      };
      logCall(deps, "dsh_lightrag_status", started, {
        status: result.status,
        coreVersion: result.coreVersion,
        pipelineBusy: result.pipelineBusy,
        documentCount: result.statusCounts.reduce(
          (total, entry) =>
            entry.status === "all" ? total : total + entry.count,
          0,
        ),
      });
      return result;
    },
  });
}
