/**
 * The model-facing memory tools' account-scoped fallback.
 *
 * The MCP bridge serves every session of a deployment through one stdio proxy
 * whose identity is the deployment's own: `mcp.ts` forwards the resolved
 * config through the child environment, and a child process outlives sessions,
 * so a forwarded `search`/`find` can never carry the asking session's account.
 * Under `qaUserScoping` the runtime's own reads and writes ARE account-scoped
 * (`runtime.adoptScoping`), so the space the model's retrieval tools read is
 * not the space the session's memory was written into — an upstream answer of
 * "no matches" is then a fact about the deployment space, not about the
 * account's memory (the wave acceptance of 2026-10-28, lane L05: a confirmed
 * seed the model could not recall with its own tools).
 *
 * This module carries the two decisions the fallback needs: whether a tool
 * call is one of the retrieval tools worth re-reading for, and whether an
 * upstream answer already names memory (every hit carries a `viking://` URI,
 * so a result without one is an empty answer rather than a negative one).
 */

import { MCP_SERVER_NAME } from "../config.js";

/** Model-facing name of a bridged OpenViking MCP tool. */
const mcp = (rawName: string): string => `mcp__${MCP_SERVER_NAME}__${rawName}`;

/**
 * The retrieval tools whose empty answer the account-scoped re-read can
 * correct, and the argument that carries the free-text query of each. The
 * same contract `servers/mcp-proxy.ts` validates at the proxy boundary.
 */
export const MEMORY_SEARCH_TOOLS: Readonly<Record<string, string>> = {
  [mcp("search")]: "query",
  [mcp("find")]: "query",
  [mcp("grep")]: "pattern",
};

/** Whether the named call is one of the bridged retrieval tools. */
export function isMemorySearchTool(name: string): boolean {
  return Object.hasOwn(MEMORY_SEARCH_TOOLS, name);
}

/**
 * The free-text query one retrieval call carries, or null when the call is
 * not a retrieval tool or its text argument is missing or blank — the same
 * shape the proxy's empty-argument guard refuses upstream.
 */
export function memoryToolQueryOf(name: string, args: unknown): string | null {
  const key = MEMORY_SEARCH_TOOLS[name];
  if (key === undefined) return null;
  const record =
    args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Structural view of one text content block; avoids a `dsh-llm` peer. */
interface TextBlockLike {
  readonly type?: unknown;
  readonly text?: unknown;
}

/** Structural view of the tool result the fallback inspects. */
export interface ToolResultLike {
  readonly isError?: unknown;
  readonly content?: unknown;
}

/**
 * Whether a tool answer already names memory. Every OpenViking hit cites its
 * `viking://` URI, so a successful answer without one is an empty answer —
 * including the upstream "no matches" spellings that read as a real negative
 * to a model.
 */
export function resultCarriesMemoryHits(result: ToolResultLike): boolean {
  if (result.isError === true) return true;
  const blocks = Array.isArray(result.content)
    ? (result.content as TextBlockLike[])
    : [];
  return blocks.some(
    (block) =>
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.includes("viking://"),
  );
}
