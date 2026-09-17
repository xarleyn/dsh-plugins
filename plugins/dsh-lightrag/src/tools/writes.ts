/**
 * The write tools — `dsh_lightrag_insert`, `dsh_lightrag_scan` and
 * `dsh_lightrag_delete` — registered only when `writes.enabled` is true
 * (SPEC §1, §4.2).
 *
 * A write tool that is not registered cannot be named by a deployment's tool
 * allow-list either, which is why the switch exists at all: the QA surface this
 * repository deploys runs agents read-only, and an allow-list entry naming a
 * tool that never registers refuses the attestation. Each factory therefore
 * also guards its own body, so a tool reached through a stale reference fails
 * with the same stable code instead of writing.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import { LightRagError } from "../errors.js";
import {
  byteLength,
  logCall,
  requireText,
  optionalText,
  SERVICE_NOTE,
  UNTRUSTED_NOTE,
  type LightRagToolDeps,
} from "./shared.js";

export interface LightRagInsertResult {
  readonly trackId: string;
  readonly status: string;
  readonly message: string;
}

export interface LightRagScanResult {
  readonly trackId: string;
  readonly status: string;
  readonly message: string;
}

export interface LightRagDeleteResult {
  readonly docId: string;
  readonly status: string;
  readonly message: string;
}

/** Refuse every write when the deployment kept the tools switched off. */
function requireWritesEnabled(deps: LightRagToolDeps): void {
  if (!deps.config.writesEnabled) {
    throw new LightRagError(
      "disabled",
      "write tools are disabled for this deployment",
    );
  }
}

export function createLightRagInsertTool(deps: LightRagToolDeps) {
  const client = deps.clientOverride ?? deps.client;
  return defineTool({
    name: "dsh_lightrag_insert",
    description: [
      "Insert a text document into this deployment's LightRAG knowledge base.",
      "Ingestion is asynchronous: the call returns a track id as soon as the server accepted the text, and the graph and vector index fill in afterwards.",
      `This changes the knowledge base. ${SERVICE_NOTE} ${UNTRUSTED_NOTE}`,
    ].join(" "),
    parameters: {
      text: {
        type: "string",
        required: true,
        description:
          "The document text to ingest. Bounded by the deployment's write byte cap.",
      },
      source: {
        type: "string",
        description:
          "Source label recorded with the document, typically a file path or a URL.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          trackId: {
            type: "string",
            required: true,
            description: "Ingestion track id; the pipeline is still running.",
          },
          status: {
            type: "string",
            required: true,
            description: "success, partial_success or failure.",
          },
          message: { type: "string", required: true },
        },
      },
      render: (_args, value: LightRagInsertResult) => [
        {
          type: "text",
          text: `insert ${value.status}: ${value.message} (track ${value.trackId})`,
        },
      ],
    },
    async execute(args, exec) {
      requireWritesEnabled(deps);
      const started = Date.now();
      const text = requireText(args.text, "text", {
        maxBytes: deps.config.writesMaxTextBytes,
      });
      const source = optionalText(args.source, "source") ?? "";
      const result = await client.insertText(
        { text, source },
        { signal: exec.signal },
      );
      logCall(deps, "dsh_lightrag_insert", started, {
        textBytes: byteLength(text),
        hasSource: source !== "",
        status: result.status,
      });
      return result;
    },
  });
}

export function createLightRagScanTool(deps: LightRagToolDeps) {
  const client = deps.clientOverride ?? deps.client;
  return defineTool({
    name: "dsh_lightrag_scan",
    description: [
      "Ingest every new file the LightRAG server finds in its own input directory.",
      "Use it after a corpus update has been copied into the knowledge base's input directory; files already indexed are not read again.",
      `This changes the knowledge base. ${SERVICE_NOTE} ${UNTRUSTED_NOTE}`,
    ].join(" "),
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          trackId: {
            type: "string",
            required: true,
            description: "Ingestion track id; the pipeline is still running.",
          },
          status: {
            type: "string",
            required: true,
            description: "success, partial_success or failure.",
          },
          message: { type: "string", required: true },
        },
      },
      render: (_args, value: LightRagScanResult) => [
        {
          type: "text",
          text: `scan ${value.status}: ${value.message} (track ${value.trackId})`,
        },
      ],
    },
    async execute(_args, exec) {
      requireWritesEnabled(deps);
      const started = Date.now();
      const result = await client.scanInputDirectory({ signal: exec.signal });
      logCall(deps, "dsh_lightrag_scan", started, { status: result.status });
      return result;
    },
  });
}

export function createLightRagDeleteTool(deps: LightRagToolDeps) {
  const client = deps.clientOverride ?? deps.client;
  return defineTool({
    name: "dsh_lightrag_delete",
    description: [
      "Remove one document from the LightRAG knowledge base by its id.",
      "The index entry and its extracted graph data go; the source file in the server's input directory is left alone, so a later scan can ingest it again.",
      "Find the id with dsh_lightrag_documents first.",
      `This changes the knowledge base. ${SERVICE_NOTE} ${UNTRUSTED_NOTE}`,
    ].join(" "),
    parameters: {
      documentId: {
        type: "string",
        required: true,
        description:
          "Id of the document to remove, as reported by dsh_lightrag_documents.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          docId: { type: "string", required: true },
          status: { type: "string", required: true },
          message: { type: "string", required: true },
        },
      },
      render: (_args, value: LightRagDeleteResult) => [
        {
          type: "text",
          text: `delete ${value.status}: ${value.message} (doc ${value.docId})`,
        },
      ],
    },
    async execute(args, exec) {
      requireWritesEnabled(deps);
      const started = Date.now();
      const documentId = requireText(args.documentId, "documentId");
      const result = await client.deleteDocument(
        { documentId },
        { signal: exec.signal },
      );
      logCall(deps, "dsh_lightrag_delete", started, {
        status: result.status,
      });
      return result;
    },
  });
}
