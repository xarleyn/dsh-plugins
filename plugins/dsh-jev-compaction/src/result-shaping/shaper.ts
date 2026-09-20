/**
 * The immediate result shaper (result-shaping SPEC §14): the staged pipeline
 * that turns one oversized tool result into a smaller one.
 *
 *   raw text
 *     ↓  deterministic segmentation + line-shape clustering
 *   collapsible runs
 *     ↓  deterministic pins (head, tail, conclusions) split the runs
 *   classifier questions, bounded and batched
 *     ↓  local policy: collapse only on a decisive pair of answers
 *   reconstruction with neutral markers
 *     ↓  minimum-savings gate
 *   shaped text, or nothing at all
 *
 * Every stage fails towards keeping the original. The pipeline never throws:
 * a failure is a skip, counted and logged, and the caller keeps the result it
 * already had.
 */

import type { ResolvedJevCompactionConfig } from "../config.js";
import type { SystemOneBackend } from "../jev/types.js";
import { estimateStateTokens } from "../jev/types.js";
import {
  shortRef,
  type ArchivedToolResult,
  type OriginalResultArchive,
} from "../archive/types.js";
import { contentRef } from "../archive/hash.js";
import { analyzeText } from "./cluster.js";
import type { LineRun } from "./cluster.js";
import { evaluateTrigger } from "./eligibility.js";
import {
  SHAPE_METRICS,
  type ShapeSkipReason,
  type ShapingMetrics,
} from "./metrics.js";
import { decideRun, type RunScores } from "./policy.js";
import {
  NEEDED_PREFIX,
  ROUTINE_PREFIX,
  batchRuns,
  buildRunQuestions,
  buildShapingState,
  runId,
} from "./questions.js";
import { reconstruct, runSavings } from "./reconstruct.js";
import { extractText, replaceText, type ContentBlockLike } from "./text.js";

/** Everything the shaper needs from its owner. */
export interface ShaperDeps {
  readonly readConfig: () => ResolvedJevCompactionConfig;
  readonly backend: SystemOneBackend;
  readonly archive: OriginalResultArchive;
  readonly metrics: ShapingMetrics;
  /** Structured skip log line; never throws. */
  readonly onSkip: (
    reason: ShapeSkipReason,
    details: Record<string, unknown>,
  ) => void;
  /** Structured success log line; never throws. */
  readonly onShaped: (details: Record<string, unknown>) => void;
}

/** One result offered to the shaper. */
export interface ShapeInput<T extends ContentBlockLike = ContentBlockLike> {
  readonly callId: string;
  readonly toolName: string;
  readonly sessionId?: string;
  readonly isError: boolean;
  readonly content: readonly T[];
  readonly argumentsPreview?: string;
  readonly goal: string;
  readonly signal?: AbortSignal;
  /**
   * Reserve this turn's budget for one classifier request. Called only after
   * every cheap eligibility check has passed, so a result that is too small,
   * disabled or outside the tool list never spends the turn's allowance.
   */
  readonly reserve?: (chars: number) => boolean;
}

/** What shaping produced. */
export interface ShapeOutcome<T extends ContentBlockLike = ContentBlockLike> {
  readonly content: T[];
  readonly originalChars: number;
  readonly shapedChars: number;
  readonly savedChars: number;
  readonly collapsedRuns: number;
  readonly collapsedLines: number;
  readonly archiveRef?: string;
  readonly jevRequests: number;
}

/**
 * Combine the caller's cancellation with the shaper's own request deadline.
 * The deadline bounds the critical path even when the transport's own timeout
 * is misconfigured high.
 */
function withDeadline(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("shaping request timed out")),
    timeoutMs,
  );
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal !== undefined) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      if (signal !== undefined) signal.removeEventListener("abort", onAbort);
    },
  };
}

function isTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|abort|cancel/i.test(message);
}

export class ImmediateResultShaper {
  private readonly deps: ShaperDeps;

  constructor(deps: ShaperDeps) {
    this.deps = deps;
  }

  /**
   * Run the pipeline for one result. Returns `undefined` when the result must
   * be kept exactly as it is, which is the answer for every failure mode.
   */
  async maybeShape<T extends ContentBlockLike>(
    input: ShapeInput<T>,
  ): Promise<ShapeOutcome<T> | undefined> {
    const config = this.deps.readConfig();
    const metrics = this.deps.metrics;
    metrics.increment(SHAPE_METRICS.seen);
    const skip = (reason: ShapeSkipReason): undefined => {
      metrics.increment(SHAPE_METRICS.skipped);
      metrics.increment(`${SHAPE_METRICS.skipped}.${reason}`);
      this.deps.onSkip(reason, {
        tool: input.toolName,
        callId: input.callId,
      });
      return undefined;
    };

    const extracted = extractText(input.content);
    if (extracted === undefined) return skip("unsupported-content");

    const analysis = analyzeText(extracted.text, {
      minRunLines: config.resultShaping.minRunLines,
      keepHeadLines: config.resultShaping.keepHeadLines,
      keepTailLines: config.resultShaping.keepTailLines,
    });

    const verdict = evaluateTrigger(
      {
        toolName: input.toolName,
        isError: input.isError,
        text: extracted.text,
        lineCount: analysis.lines.length,
        repetitionRatio: analysis.repetitionRatio,
      },
      config,
    );
    if (!verdict.eligible) return skip(verdict.reason);
    if (analysis.runs.length === 0) return skip("not-repetitive");

    metrics.increment(SHAPE_METRICS.eligible);
    if (input.reserve !== undefined && !input.reserve(extracted.text.length)) {
      return skip("turn-budget");
    }
    metrics.add(SHAPE_METRICS.originalChars, extracted.text.length);

    const collapsed = await this.classify(
      input,
      config,
      analysis.runs,
      extracted.text.length,
      analysis.lines.length,
    );
    if (collapsed === undefined) return skip("jev-error");

    const accepted: LineRun[] = [];
    let sawLowConfidence = false;
    for (const run of analysis.runs) {
      const scores: RunScores = collapsed.get(runId(run)) ?? {};
      const runVerdict = decideRun(
        scores,
        config.resultShaping.minClassificationConfidence,
      );
      if (runVerdict.decision === "collapse") accepted.push(run);
      else if (runVerdict.reason === "low-confidence") sawLowConfidence = true;
    }
    if (accepted.length === 0) {
      metrics.increment(SHAPE_METRICS.keptOriginal);
      return skip(sawLowConfidence ? "low-confidence" : "not-repetitive");
    }

    const savedByRuns = accepted.reduce(
      (sum, run) => sum + runSavings(analysis.lines, run),
      0,
    );
    const savedRatio = savedByRuns / extracted.text.length;
    const savings = config.resultShaping;
    const savingsMet =
      (savings.minSavingsChars <= 0 && savings.minSavingsRatio <= 0) ||
      savedByRuns >= savings.minSavingsChars ||
      savedRatio >= savings.minSavingsRatio;
    if (!savingsMet) {
      metrics.increment(SHAPE_METRICS.keptOriginal);
      return skip("low-savings");
    }

    const archiveRef = await this.archive(input, config, extracted.text);
    if (archiveRef === "blocked") {
      metrics.increment(SHAPE_METRICS.keptOriginal);
      return skip("archive-error");
    }

    const text = reconstruct({
      lines: analysis.lines,
      collapsed: accepted,
      ...(archiveRef === undefined ? {} : { archiveRef }),
    });
    const collapsedLines = accepted.reduce((sum, run) => sum + run.count, 0);
    metrics.increment(SHAPE_METRICS.shaped);
    metrics.add(SHAPE_METRICS.persistedChars, text.length);
    metrics.add(SHAPE_METRICS.savedChars, extracted.text.length - text.length);
    metrics.add(SHAPE_METRICS.collapsedLines, collapsedLines);
    this.deps.onShaped({
      tool: input.toolName,
      callId: input.callId,
      runs: accepted.length,
      lines: collapsedLines,
      originalChars: extracted.text.length,
      shapedChars: text.length,
      archiveRef,
    });

    return {
      content: replaceText(input.content, extracted, text),
      originalChars: extracted.text.length,
      shapedChars: text.length,
      savedChars: extracted.text.length - text.length,
      collapsedRuns: accepted.length,
      collapsedLines,
      ...(archiveRef === undefined ? {} : { archiveRef }),
      jevRequests: collapsed.jevRequests,
    };
  }

  /**
   * Ask the classifier about every run. `undefined` means the request failed,
   * which keeps the whole result — a transport error is never a reason to
   * delete output.
   */
  private async classify<T extends ContentBlockLike>(
    input: ShapeInput<T>,
    config: ResolvedJevCompactionConfig,
    runs: readonly LineRun[],
    totalChars: number,
    totalLines: number,
  ): Promise<(Map<string, RunScores> & { jevRequests: number }) | undefined> {
    const metrics = this.deps.metrics;
    const shaping = config.resultShaping;
    const state = buildShapingState({
      toolName: input.toolName,
      ...(input.argumentsPreview === undefined
        ? {}
        : { argumentsPreview: input.argumentsPreview }),
      goal: input.goal,
      totalChars,
      totalLines,
      runs,
      sampleChars: config.state.resultPreviewChars,
    });
    const batches = batchRuns(
      runs,
      state,
      config.state.resultPreviewChars,
      config.state.maxRequestTokens,
    );
    const scores = new Map<string, RunScores>();
    let jevRequests = 0;

    for (const batch of batches) {
      const questions = buildRunQuestions(
        batch,
        config.state.resultPreviewChars,
      );
      const deadline = withDeadline(input.signal, shaping.requestTimeoutMs);
      const startedAt = Date.now();
      try {
        jevRequests += 1;
        metrics.increment(SHAPE_METRICS.requests);
        metrics.add(
          SHAPE_METRICS.jevInputEstimate,
          estimateStateTokens(JSON.stringify(state)) +
            estimateStateTokens(JSON.stringify(questions)),
        );
        const answers = await this.deps.backend.score(
          state,
          questions,
          deadline.signal,
        );
        metrics.add(SHAPE_METRICS.jevLatencyMs, Date.now() - startedAt);
        for (const run of batch) {
          const id = runId(run);
          const routine = answers.get(`${ROUTINE_PREFIX}${id}`);
          const needed = answers.get(`${NEEDED_PREFIX}${id}`);
          scores.set(id, {
            ...(routine === undefined ? {} : { routine }),
            ...(needed === undefined ? {} : { needed }),
          });
        }
      } catch (error: unknown) {
        metrics.add(SHAPE_METRICS.jevLatencyMs, Date.now() - startedAt);
        metrics.increment(SHAPE_METRICS.errors);
        if (isTimeout(error)) metrics.increment(SHAPE_METRICS.timeouts);
        this.deps.onSkip("jev-error", {
          tool: input.toolName,
          callId: input.callId,
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      } finally {
        deadline.dispose();
      }
    }
    return Object.assign(scores, { jevRequests });
  }

  /**
   * Settle an archive write against the shaper's deadline. The store keeps
   * its own size bound; this bounds how long the tool path may wait for it.
   */
  private withArchiveDeadline<T>(
    work: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(new Error("archive write timed out"));
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(new Error("archive write timed out"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      work.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /**
   * Store the pre-shaping content. Returns the short reference, `undefined`
   * when archiving is disabled, or `"blocked"` when the archive failed under
   * the `keep-original` policy.
   */
  private async archive<T extends ContentBlockLike>(
    input: ShapeInput<T>,
    config: ResolvedJevCompactionConfig,
    text: string,
  ): Promise<string | undefined | "blocked"> {
    if (!config.archive.enabled) return undefined;
    const metrics = this.deps.metrics;
    const entry: ArchivedToolResult = {
      version: 1,
      createdAt: new Date().toISOString(),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      callId: input.callId,
      toolName: input.toolName,
      content: input.content,
      contentHash: contentRef(input.content),
      charCount: Array.from(text).length,
    };
    const deadline = withDeadline(
      input.signal,
      config.resultShaping.requestTimeoutMs,
    );
    try {
      // The deadline is enforced here, not inside the store: a filesystem
      // write cannot be aborted, and the tool path must not wait on a stuck
      // one. Losing the race keeps the original, which is the safe answer even
      // if the write happens to land afterwards.
      const ref = await this.withArchiveDeadline(
        this.deps.archive.put(entry, { signal: deadline.signal }),
        deadline.signal,
      );
      metrics.increment(SHAPE_METRICS.archiveWrites);
      return shortRef(ref);
    } catch (error: unknown) {
      metrics.increment(SHAPE_METRICS.archiveFailures);
      this.deps.onSkip("archive-error", {
        tool: input.toolName,
        callId: input.callId,
        error: error instanceof Error ? error.message : String(error),
      });
      return config.archive.onFailure === "shape-anyway"
        ? undefined
        : "blocked";
    } finally {
      deadline.dispose();
    }
  }
}
