/**
 * Jev classification of one result's runs (result-shaping SPEC §18).
 *
 * The immediate shaper asks different questions than historical compaction:
 * not "is this historical result still needed" but "is this group of adjacent
 * lines routine repetition, and would dropping it change the next decision".
 * The state carries the goal, the tool call and the runs as one-line records;
 * the sample text travels inside its own question, bounded by
 * `state.resultPreviewChars`, so a 100 KB log never becomes one request.
 */

import type { JevQuestion, JevState } from "../jev/types.js";
import { estimateStateTokens } from "../jev/types.js";
import type { LineRun } from "./cluster.js";

/** Context paragraph sent with every shaping request. */
export const SHAPING_CONTEXT =
  "A tool call has just finished and its output is about to be added to the " +
  "conversation. Some blocks of the output repeat a single line shape many " +
  "times (progress bars, per-item chatter, per-test pass lines). Each " +
  "question names one such block and asks whether it is routine repetition " +
  "and whether dropping it would change the assistant's next decision. " +
  "Blocks that carry outcomes, failures, warnings or unique evidence must be " +
  "kept; the original output is not recoverable afterwards unless archived.";

/** Everything one shaping request needs to describe the result. */
export interface ShapingRequestInput {
  readonly toolName: string;
  readonly argumentsPreview?: string;
  readonly goal: string;
  readonly totalChars: number;
  readonly totalLines: number;
  readonly runs: readonly LineRun[];
  /** Character budget for one run's sample line. */
  readonly sampleChars: number;
}

/** Question-name prefix for the "is this routine repetition" question. */
export const ROUTINE_PREFIX = "routine_l";
/** Question-name prefix for the "would dropping it hurt" question. */
export const NEEDED_PREFIX = "needed_l";

function truncate(text: string, limit: number): string {
  if (limit <= 0) return "";
  return text.length <= limit
    ? text
    : `${text.slice(0, Math.max(0, limit - 1))}\u2026`;
}

/** Stable question id for one run (its first line index). */
export function runId(run: LineRun): string {
  return `l${run.start}`;
}

/** The state sent with a shaping request (bounded, deterministic). */
export function buildShapingState(input: ShapingRequestInput): JevState {
  const args =
    input.argumentsPreview === undefined || input.argumentsPreview.length === 0
      ? "(none)"
      : truncate(input.argumentsPreview, 400);
  const history = [
    {
      label: `tool ${input.toolName}`,
      text:
        `arguments: ${args}\n` +
        `result: ${input.totalChars} chars over ${input.totalLines} lines\n` +
        `repeated blocks:\n` +
        input.runs
          .map(
            (run) =>
              `  ${runId(run)}: ${run.count} adjacent lines, first at line ${run.start + 1}`,
          )
          .join("\n"),
    },
  ];
  return {
    context: SHAPING_CONTEXT,
    goal: input.goal,
    history,
  };
}

/**
 * Two yes/no questions per run: is this block routine repetition, and would
 * removing it materially reduce the ability to make the correct next
 * decision. The local policy turns the pair into one decision (§19).
 */
export function buildRunQuestions(
  runs: readonly LineRun[],
  sampleChars: number,
): JevQuestion[] {
  const questions: JevQuestion[] = [];
  for (const run of runs) {
    const id = runId(run);
    const sample = truncate(run.sample, sampleChars);
    questions.push({
      name: `${ROUTINE_PREFIX}${id}`,
      instructions:
        `Is this block of tool output routine repetition, where the ${run.count} ` +
        "adjacent lines below share one shape and differ only in values such as " +
        "timestamps, counters, percentages or hashes, so that reading one of them " +
        "carries everything the others say?\n" +
        `---\n${sample}\n---`,
    });
    questions.push({
      name: `${NEEDED_PREFIX}${id}`,
      instructions:
        "Would removing this block of output materially reduce the assistant's " +
        "ability to make the correct next decision about the user's current " +
        "task?\n" +
        `---\n${sample}\n---`,
    });
  }
  return questions;
}

/**
 * Split runs into request-sized chunks: each request repeats the state, so a
 * chunk's questions must fit `maxRequestTokens` minus the state's own size. A
 * run whose questions cannot fit even alone is dropped from the request list
 * and therefore kept — the cap bounds cost, it never licenses a drop.
 */
export function batchRuns(
  runs: readonly LineRun[],
  state: JevState,
  sampleChars: number,
  maxRequestTokens: number,
): LineRun[][] {
  const stateTokens = estimateStateTokens(JSON.stringify(state));
  const batches: LineRun[][] = [];
  let current: LineRun[] = [];
  let currentTokens = stateTokens;
  for (const run of runs) {
    const cost = estimateStateTokens(
      JSON.stringify(buildRunQuestions([run], sampleChars)),
    );
    if (current.length > 0 && currentTokens + cost > maxRequestTokens) {
      batches.push(current);
      current = [];
      currentTokens = stateTokens;
    }
    if (stateTokens + cost > maxRequestTokens) continue;
    current.push(run);
    currentTokens += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
