import { createHash } from "node:crypto";
import type { ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import { TOOL_LOOP_LIMITS } from "./shared/tool-loop-rules.js";

export interface ToolLoopResult {
  readonly kind: string;
  readonly digest: string;
  readonly sample: string | undefined;
}

export function toolLoopResult(
  result: ToolExecutionResult,
  maxDifferencePercent: number,
): ToolLoopResult {
  const text = result.isError
    ? result.error.message
    : typeof result.value === "string"
      ? result.value
      : JSON.stringify(result.value);
  return {
    kind: result.isError
      ? `error:${result.error.info?.code ?? ""}`
      : `success:${typeof result.value}`,
    digest: createHash("sha256").update(text).digest("hex"),
    sample:
      maxDifferencePercent > 0 &&
      text.length <= TOOL_LOOP_LIMITS.comparableCharacters
        ? text
        : undefined,
  };
}

/** Compare results to the first result in the run so small changes cannot accumulate. */
export function sameToolLoopResult(
  first: ToolLoopResult,
  next: ToolLoopResult,
  maxDifferencePercent: number,
): boolean {
  if (first.kind !== next.kind) return false;
  if (first.digest === next.digest) return true;
  if (first.sample === undefined || next.sample === undefined) return false;
  return withinDifference(first.sample, next.sample, maxDifferencePercent);
}

function withinDifference(
  left: string,
  right: string,
  percent: number,
): boolean {
  const from = Array.from(left);
  const to = Array.from(right);
  const limit = Math.floor((Math.max(from.length, to.length) * percent) / 100);
  if (Math.abs(from.length - to.length) > limit || limit === 0) return false;

  let start = 0;
  let fromEnd = from.length;
  let toEnd = to.length;
  while (start < fromEnd && start < toEnd && from[start] === to[start]) start++;
  while (
    fromEnd > start &&
    toEnd > start &&
    from[fromEnd - 1] === to[toEnd - 1]
  ) {
    fromEnd--;
    toEnd--;
  }

  if (Math.max(fromEnd, toEnd) - start <= limit) return true;

  // Levenshtein distance over the changed part, with two rows of storage.
  const width = toEnd - start;
  let previous = new Uint16Array(width + 1);
  let current = new Uint16Array(width + 1);
  for (let column = 0; column <= width; column++) previous[column] = column;
  for (let row = start; row < fromEnd; row++) {
    current[0] = row - start + 1;
    let best = current[0];
    for (let column = 1; column <= width; column++) {
      const cost = from[row] === to[start + column - 1] ? 0 : 1;
      const distance = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + cost,
      );
      current[column] = distance;
      best = Math.min(best, distance);
    }
    if (best > limit) return false;
    const next = previous;
    previous = current;
    current = next;
  }
  return previous[width]! <= limit;
}
