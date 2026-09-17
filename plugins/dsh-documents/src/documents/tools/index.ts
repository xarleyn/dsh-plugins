/**
 * The five agent-facing document tools (§8–§11, §34) and their registration.
 *
 * Registration is explicit and returns its disposers: the host may register
 * them globally (the default) or an agent scope may register the same
 * definitions later, which is what a deployment that wants progressive
 * disclosure needs. Nothing here decides *whether* document tools are visible;
 * that is the deployment's allow-list.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";

import type { DocumentRuntime } from "../runtime.js";
import { createDocumentCompareTool, DOCUMENT_COMPARE_TOOL } from "./compare.js";
import { createDocumentConvertTool, DOCUMENT_CONVERT_TOOL } from "./convert.js";
import { createDocumentCreateTool, DOCUMENT_CREATE_TOOL } from "./create.js";
import {
  createDocumentDiffReadTool,
  DOCUMENT_DIFF_READ_TOOL,
} from "./diff-read.js";
import {
  createDocumentFromUrlTool,
  DOCUMENT_FROM_URL_TOOL,
} from "./from-url.js";
import { createDocumentInspectTool, DOCUMENT_INSPECT_TOOL } from "./inspect.js";
import {
  createDocumentToMarkdownTool,
  DOCUMENT_TO_MARKDOWN_TOOL,
} from "./to-markdown.js";

/** Exact names of the tools this subsystem always registers. */
export const DOCUMENT_TOOL_NAMES: readonly string[] = [
  DOCUMENT_CREATE_TOOL,
  DOCUMENT_TO_MARKDOWN_TOOL,
  DOCUMENT_FROM_URL_TOOL,
  DOCUMENT_CONVERT_TOOL,
  DOCUMENT_INSPECT_TOOL,
];

/**
 * Tools that exist only while `documents.comparison.enabled` is on. They are
 * listed apart from {@link DOCUMENT_TOOL_NAMES} because an allow-list names
 * what a deployment expects to exist, and these two may legitimately be absent.
 */
export const DOCUMENT_COMPARISON_TOOL_NAMES: readonly string[] = [
  DOCUMENT_COMPARE_TOOL,
  DOCUMENT_DIFF_READ_TOOL,
];

export {
  DOCUMENT_COMPARE_TOOL,
  DOCUMENT_CONVERT_TOOL,
  DOCUMENT_CREATE_TOOL,
  DOCUMENT_DIFF_READ_TOOL,
  DOCUMENT_FROM_URL_TOOL,
  DOCUMENT_INSPECT_TOOL,
  DOCUMENT_TO_MARKDOWN_TOOL,
};

/**
 * The tool names a configuration resolves to: the five semantic tools, plus
 * the two comparison tools while `comparison.enabled` is on (§31). One
 * function answers this for the registration, the subsystem report and the
 * tests, so an allow-list can never be written against a set the plugin does
 * not actually register.
 */
export function documentToolNames(config: {
  readonly comparison: { readonly enabled: boolean };
}): readonly string[] {
  return config.comparison.enabled
    ? [...DOCUMENT_TOOL_NAMES, ...DOCUMENT_COMPARISON_TOOL_NAMES]
    : [...DOCUMENT_TOOL_NAMES];
}

export function createDocumentTools(options: {
  readonly runtime: DocumentRuntime;
}): ToolDefinition[] {
  return [
    createDocumentCreateTool(options),
    createDocumentToMarkdownTool(options),
    createDocumentFromUrlTool(options),
    createDocumentConvertTool(options),
    createDocumentInspectTool(options),
    ...(options.runtime.config.comparison.enabled
      ? [
          createDocumentCompareTool(options),
          createDocumentDiffReadTool(options),
        ]
      : []),
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
