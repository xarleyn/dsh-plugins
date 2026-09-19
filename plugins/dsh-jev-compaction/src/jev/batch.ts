/**
 * Question batching with a bounded request budget and bounded concurrency
 * (SPEC §19). The state is sent complete with every batch; a batch's
 * questions must fit `maxRequestTokens - stateTokens`, otherwise the
 * candidates are split further. A batch that cannot fit even alone fails the
 * run fail-open at the caller.
 */

import type { ToolResultCandidate } from "../planner/collect.js";
import { estimateStateTokens } from "./types.js";
import { questionsFor } from "./questions.js";

/** Split candidates into batches that fit one request each. */
export function batchCandidates(
  candidates: readonly ToolResultCandidate[],
  stateTokens: number,
  maxRequestTokens: number,
): ToolResultCandidate[][] {
  const questionTokens = new Map<string, number>();
  const perCandidateTokens = (candidate: ToolResultCandidate): number => {
    let cached = questionTokens.get(candidate.callId);
    if (cached === undefined) {
      cached = estimateStateTokens(JSON.stringify(questionsFor([candidate])));
      questionTokens.set(candidate.callId, cached);
    }
    return cached;
  };

  const batches: ToolResultCandidate[][] = [];
  let current: ToolResultCandidate[] = [];
  let currentTokens = stateTokens;
  for (const candidate of candidates) {
    const cost = perCandidateTokens(candidate);
    if (current.length > 0 && currentTokens + cost > maxRequestTokens) {
      batches.push(current);
      current = [];
      currentTokens = stateTokens;
    }
    current.push(candidate);
    currentTokens += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Run batch tasks with a bounded concurrency pool; results resolve in input
 * order. A rejected task rejects the whole pool (the caller fails open).
 */
export async function mapWithConcurrency<TIn, TOut>(
  inputs: readonly TIn[],
  limit: number,
  task: (input: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results = new Array<TOut>(inputs.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, inputs.length)) },
    async () => {
      while (cursor < inputs.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await task(inputs[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
