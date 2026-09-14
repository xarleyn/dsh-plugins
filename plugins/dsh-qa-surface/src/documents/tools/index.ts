/**
 * The four agent-facing document tools (§8–§11, §34) and their registration.
 *
 * Registration is explicit and returns its disposers: the host may register
 * them globally (the default) or an agent scope may register the same
 * definitions later, which is what a deployment that wants progressive
 * disclosure needs. Nothing here decides *whether* document tools are visible;
 * that is the deployment's allow-list.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";

import type { DocumentRuntime } from "../runtime.js";
import { createDocumentConvertTool, DOCUMENT_CONVERT_TOOL } from "./convert.js";
import { createDocumentCreateTool, DOCUMENT_CREATE_TOOL } from "./create.js";
import { createDocumentInspectTool, DOCUMENT_INSPECT_TOOL } from "./inspect.js";
import {
  createDocumentToMarkdownTool,
  DOCUMENT_TO_MARKDOWN_TOOL,
} from "./to-markdown.js";

/** Exact names of the tools this subsystem registers (allow-list contract). */
export const DOCUMENT_TOOL_NAMES: readonly string[] = [
  DOCUMENT_CREATE_TOOL,
  DOCUMENT_TO_MARKDOWN_TOOL,
  DOCUMENT_CONVERT_TOOL,
  DOCUMENT_INSPECT_TOOL,
];

export {
  DOCUMENT_CONVERT_TOOL,
  DOCUMENT_CREATE_TOOL,
  DOCUMENT_INSPECT_TOOL,
  DOCUMENT_TO_MARKDOWN_TOOL,
};

export function createDocumentTools(options: {
  readonly runtime: DocumentRuntime;
}): ToolDefinition[] {
  return [
    createDocumentCreateTool(options),
    createDocumentToMarkdownTool(options),
    createDocumentConvertTool(options),
    createDocumentInspectTool(options),
  ];
}

/** Anything that can accept a tool definition; the host's registry facade. */
export interface DocumentToolRegistry {
  register(definition: ToolDefinition): () => void;
}

/**
 * Register every document tool and return one disposer. `enabled: false` is
 * handled by the caller: the surface is then absent rather than inert.
 */
export function registerDocumentTools(
  registry: DocumentToolRegistry,
  options: { readonly runtime: DocumentRuntime },
): () => void {
  const disposers = createDocumentTools(options).map((definition) =>
    registry.register(definition),
  );
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
