/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 *
 * `viking://` guard: OpenViking URIs are virtual database paths. Handing one to
 * a filesystem or shell tool is always a mistake, so the call is denied with a
 * hint naming the OpenViking tool that does the job. The guard is independent of
 * the injection controls — it protects the same URIs in every mode.
 */

import { MCP_SERVER_NAME } from "./config.js";
import { buildGuardMessage, findVikingUri } from "./openviking/uri-guard.js";

/** Model-facing name of a bridged OpenViking MCP tool. */
const mcp = (rawName: string): string => `mcp__${MCP_SERVER_NAME}__${rawName}`;

/** Structural view of the tool call the guard inspects. */
export interface ToolExecutionLike {
  readonly name: string;
  readonly arguments: unknown;
}

/** The subset of the pre-execute decision this guard produces. */
export type VikingUriDecision =
  { kind: "allow" } | { kind: "deny"; reason: string };

interface GuardHint {
  readonly tool: string;
  readonly example: (uri: string, args?: Record<string, unknown>) => string;
}

const GUARDED_TOOLS: Record<string, GuardHint> = {
  read: {
    tool: mcp("read"),
    example: (uri) => `${mcp("read")}(uris="${uri}")`,
  },
  glob: {
    tool: mcp("list"),
    example: (uri) => `${mcp("list")}(uri="${uri}")`,
  },
  grep: {
    tool: mcp("grep"),
    example: (uri, args) =>
      `${mcp("grep")}(pattern="${escapeText(args?.["pattern"])}", uri="${uri}")`,
  },
  bash: {
    tool: `${mcp("read")} or ${mcp("search")}`,
    example: (uri) => `${mcp("read")}(uris="${uri}")`,
  },
  edit: {
    tool: mcp("edit"),
    example: (uri) =>
      `${mcp("edit")}(uri="${uri}", old_string="...", new_string="...")`,
  },
  write: {
    tool: mcp("write"),
    example: (uri) => `${mcp("write")}(uri="${uri}", content="...")`,
  },
  str_replace_editor: {
    tool: "the OpenViking MCP tools",
    example: (uri) => `${mcp("read")}(uris="${uri}")`,
  },
};

export async function guardVikingUri(
  exec: ToolExecutionLike,
  next: () => Promise<VikingUriDecision>,
): Promise<VikingUriDecision> {
  const hint = GUARDED_TOOLS[exec.name];
  if (!hint) return next();
  const uri = findVikingUri(exec.arguments);
  if (!uri) return next();
  const args = (exec.arguments ?? {}) as Record<string, unknown>;
  return {
    kind: "deny",
    reason: buildGuardMessage(uri, {
      tool: hint.tool,
      example: (target: string) => hint.example(target, args),
    }),
  };
}

function escapeText(value: unknown): string {
  return String(value || "").replaceAll('"', '\\"');
}
