/**
 * ResultInspector (SPEC §9.1).
 *
 * Turns a normalized `tools/post-execute` result into the plain routing
 * input: success/failure, textual-ness, raw text size, cheap token estimate,
 * and the tool identity with bounded serialized arguments.
 */

import type { ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";

import { byteLength, estimateTokens } from "../utils/text.js";

export interface OffloadCandidate {
  readonly toolName: string;
  readonly argsText: string;
  /** UTF-8 byte size of the joined textual content. */
  readonly byteLength: number;
  /** Cheap `characters / 4` estimate (SPEC §11) — labeled an estimate in telemetry. */
  readonly estimatedTokens: number;
  readonly contentText: string;
  readonly resultKind: "success" | "error";
  readonly isTextual: boolean;
}

/** Upper bound for the serialized tool arguments embedded in the worker prompt. */
export const MAX_ARGS_BYTES = 4_096;

interface TextBlockLike {
  readonly type: unknown;
  readonly text?: unknown;
}

export function inspectResult(exec: ToolExecution, result: Readonly<ToolExecutionResult>): OffloadCandidate {
  const blocks = (result.content as readonly TextBlockLike[] | undefined) ?? [];
  const textBlocks: string[] = [];
  let allTextual = blocks.length > 0;
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      textBlocks.push(block.text);
    } else {
      allTextual = false;
    }
  }
  const contentText = textBlocks.join("\n\n");
  return {
    toolName: exec.name,
    argsText: serializeArgs(exec.arguments),
    byteLength: byteLength(contentText),
    estimatedTokens: estimateTokens(contentText),
    contentText,
    resultKind: result.isError ? "error" : "success",
    isTextual: allTextual,
  };
}

/** Bounded, total serialization: routing never fails on exotic arguments. */
export function serializeArgs(args: unknown, maxBytes: number = MAX_ARGS_BYTES): string {
  let text: string;
  try {
    text = JSON.stringify(args) ?? String(args);
  } catch {
    text = String(args);
  }
  if (byteLength(text) <= maxBytes) return text;
  return `${text.slice(0, Math.max(0, Math.floor(maxBytes / 4)))}…(truncated)`;
}
