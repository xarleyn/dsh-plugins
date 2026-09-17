/**
 * `dsh_lightrag_query` — answer a question from the knowledge base and return
 * the sources the answer was built from.
 *
 * The answer is bounded by `query.maxAnswerBytes` so one call cannot flood the
 * model context, and the returned text is data: the description says so, and
 * the render marks the references as sources rather than instructions.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import { QUERY_MODES, resolveQueryMode, type QueryMode } from "../config.js";
import {
  logCall,
  optionalInteger,
  requireText,
  SERVICE_NOTE,
  truncateToBytes,
  UNTRUSTED_NOTE,
  type LightRagToolDeps,
} from "./shared.js";

export interface LightRagQueryReference {
  readonly referenceId: string;
  readonly filePath: string;
  /** Chunk contents; empty unless `withContent` asked for them. */
  readonly content: string[];
}

export interface LightRagQueryResult {
  readonly answer: string;
  /** True when the answer hit the configured byte cap and was cut. */
  readonly truncated: boolean;
  readonly referenceCount: number;
  /**
   * False when the server returned text it produced without calling its model
   * — typically the canned "no relevant context" reply.
   */
  readonly llmGenerated: boolean;
  /** Array mutability follows the output schema's inferred type. */
  readonly references: LightRagQueryReference[];
}

export function createLightRagQueryTool(deps: LightRagToolDeps) {
  const client = deps.clientOverride ?? deps.client;
  return defineTool({
    name: "dsh_lightrag_query",
    description: [
      "Answer a question from this deployment's LightRAG knowledge base and return the source documents the answer was built from.",
      "Use it to find what the indexed corpus says about a topic; the knowledge base is a graph-RAG index, so a question phrased in words rather than file names works.",
      "Returns the generated answer, the reference list (file paths, and chunk contents when withContent is true) and whether the answer was truncated.",
      "Retrieval mode defaults to the deployment's configured mode; local, global, hybrid and naive trade graph structure against plain vector search, mix uses both, and bypass skips retrieval entirely and answers from the model alone.",
      `Read-only. ${SERVICE_NOTE} ${UNTRUSTED_NOTE}`,
    ].join(" "),
    parameters: {
      question: {
        type: "string",
        required: true,
        description:
          "The question to answer from the knowledge base. At least a few words; a bare keyword retrieves poorly.",
      },
      mode: {
        type: "string",
        enum: QUERY_MODES,
        description:
          "Retrieval mode for this call, overriding the configured default. Default: the deployment's mode.",
      },
      topK: {
        type: "integer",
        description:
          "How many items to retrieve (1-200). Higher costs more and may add noise. Default: the deployment's value.",
      },
      withContent: {
        type: "boolean",
        description:
          "Include the matched chunk text of every reference. Off by default: it is much larger than the answer itself.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          answer: {
            type: "string",
            required: true,
            description: "The generated answer, bounded by the byte cap.",
          },
          truncated: {
            type: "boolean",
            required: true,
            description: "Whether the answer was cut at the byte cap.",
          },
          referenceCount: {
            type: "integer",
            required: true,
            description: "Number of source documents the server cited.",
          },
          llmGenerated: {
            type: "boolean",
            required: true,
            description:
              "False when the server returned canned text without calling its model — usually 'no relevant context'.",
          },
          references: {
            type: "array",
            required: true,
            description: "One entry per cited source document.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                referenceId: { type: "string", required: true },
                filePath: {
                  type: "string",
                  required: true,
                  description: "Path of the source document.",
                },
                content: {
                  type: "array",
                  required: true,
                  description:
                    "Matched chunk text; empty unless withContent was true.",
                  items: { type: "string" },
                },
              },
            },
          },
        },
      },
      render: (_args, value: LightRagQueryResult) => [
        {
          type: "text",
          text: [
            value.answer,
            "",
            `${value.referenceCount} reference(s)${
              value.truncated ? " — answer truncated at the byte cap" : ""
            }${value.llmGenerated ? "" : " — not generated from the index"}`,
            ...value.references.map((reference) => {
              const chunks =
                reference.content.length === 0
                  ? ""
                  : reference.content.map((chunk) => `\n  ${chunk}`).join("");
              return `[${reference.referenceId}] ${reference.filePath}${chunks}`;
            }),
          ].join("\n"),
        },
      ],
    },
    async execute(args, exec) {
      const started = Date.now();
      const config = deps.config;
      const question = requireText(args.question, "question");
      const mode: QueryMode = resolveQueryMode(args.mode ?? config.queryMode);
      const topK = optionalInteger(args.topK, "topK", 1, 200, config.queryTopK);
      const withContent = args.withContent === true;

      const answer = await client.query(
        { question, mode, topK, withContent },
        { signal: exec.signal },
      );
      const bounded = truncateToBytes(
        answer.answer,
        config.queryMaxAnswerBytes,
      );
      const result: LightRagQueryResult = {
        answer: bounded.text,
        truncated: bounded.truncated,
        referenceCount: answer.references.length,
        llmGenerated: answer.llmGenerated ?? true,
        references: answer.references.map((reference) => ({
          referenceId: reference.referenceId,
          filePath: reference.filePath,
          content: [...reference.content],
        })),
      };
      logCall(deps, "dsh_lightrag_query", started, {
        mode,
        topK,
        withContent,
        referenceCount: result.referenceCount,
        answerBytes: Buffer.byteLength(result.answer, "utf8"),
        truncated: result.truncated,
        responseTimeSeconds: answer.responseTimeSeconds,
      });
      return result;
    },
  });
}
