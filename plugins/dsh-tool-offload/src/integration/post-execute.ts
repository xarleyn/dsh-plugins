/**
 * DSH integration seam (SPEC §3.1, §7.2).
 *
 * Subscribes to `tools/post-execute`, the registry's supported
 * result-reshaping point: the downstream decision is awaited first, and on
 * success the plugin may replace only the model-facing `content` with the
 * worker's compact answer. The canonical `value` is never touched, so
 * execution-local and programmatic consumers keep the raw result
 * (SPEC §3.1, §20).
 *
 * Every failure inside the offload pipeline is contained: the downstream
 * decision (the original result) passes through unchanged (SPEC §22,
 * fail-open).
 */

import type { PostToolDecision, ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";

import type { ResolvedToolOffloadConfig } from "../config.js";
import { extractParentTask } from "../context/parent-context.js";
import { buildFallbackText } from "../fallback/fallback.js";
import type { PluginLoggerLike } from "../logging.js";
import { BUNDLED_PROMPT_PROFILES } from "../prompts/profiles.js";
import { decideRoute, type OffloadSkipReason } from "../routing/policy.js";
import { inspectResult, type OffloadCandidate } from "../routing/inspect-result.js";
import { deriveOffloadMetrics, OffloadCounters } from "../telemetry/counters.js";
import { KeyedLimiter, Semaphore } from "../utils/semaphore.js";
import { byteLength, estimateTokens } from "../utils/text.js";
import { buildWorkerPrompt } from "../worker/payload.js";
import type { WorkerOutcome, WorkerRunnerLike } from "../worker/runner.js";
import { WORKER_LABEL_PREFIX } from "../worker/runner.js";
import { validateWorkerOutput } from "../worker/validate.js";

export type ToolOffloadListener = (
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  next: () => Promise<PostToolDecision>,
) => Promise<PostToolDecision>;

export interface PostExecuteOptions {
  readonly readConfig: () => ResolvedToolOffloadConfig;
  readonly runner: WorkerRunnerLike;
  readonly counters: OffloadCounters;
  readonly logger: PluginLoggerLike;
  readonly globalGate: Semaphore;
  readonly agentGate: KeyedLimiter;
}

/** Optional machine-generated prefix on transformed content (SPEC §6.4). */
export const OFFLOAD_ANNOTATION_MARKER = "[offloaded result]";

type SkipReason = OffloadSkipReason | "no-parent-agent" | "worker-session" | "concurrency-limit";

export function createPostExecuteListener(options: PostExecuteOptions): ToolOffloadListener {
  const { readConfig, runner, counters, logger, globalGate, agentGate } = options;
  return async (exec, result, next) => {
    const downstream = await next();
    let attemptStarted = false;
    try {
      if (downstream.kind !== "accept") return downstream;
      if (exec.parent !== undefined) return downstream; // code-mode sub-dispatch: model never sees this content
      const config = readConfig();
      if (!config.enabled) return downstream;

      const agent = exec.agent;
      if (!agent) return skip(counters, logger, config, exec.name, downstream, "no-parent-agent");
      if (isDelegatedChild(agent)) {
        // Recursion guard (SPEC §25): never offload inside delegated child
        // sessions. Our own workers additionally carry no tools at all, so
        // they cannot reach this seam even in theory.
        return skip(counters, logger, config, exec.name, downstream, "worker-session");
      }

      const candidate = inspectResult(exec, result);
      counters.increment("candidates");
      counters.recordTool(candidate.toolName);

      const route = decideRoute(candidate, config);
      if (route.kind === "passthrough") {
        return skip(counters, logger, config, candidate.toolName, downstream, route.reason);
      }

      // Non-blocking budgets (SPEC §24): never queue inside post-execute.
      if (!globalGate.tryAcquire()) {
        return skip(counters, logger, config, candidate.toolName, downstream, "concurrency-limit");
      }
      const agentKey = sessionKey(agent);
      if (!agentGate.tryAcquire(agentKey)) {
        globalGate.release();
        return skip(counters, logger, config, candidate.toolName, downstream, "concurrency-limit");
      }

      attemptStarted = true;
      const profile = config.workers[route.worker] ?? config.workers[config.defaultWorker];
      if (!profile) throw new Error(`worker profile "${route.worker}" is not resolved`);
      counters.increment("started");
      counters.increment("inputBytes", candidate.byteLength);
      counters.increment("estimatedInputTokens", candidate.estimatedTokens);
      const startedAt = Date.now();
      logger.debug("offload.started", {
        tool: candidate.toolName,
        worker: route.worker,
        prompt: route.prompt,
        inputBytes: candidate.byteLength,
        estimatedTokens: candidate.estimatedTokens,
      });

      const parentTask = extractParentTask(agent, config);
      const prompt = buildWorkerPrompt({ candidate, parentTask, profileJob: resolvePromptJob(route.prompt, config) });
      const outcome = await runner.run({
        label: `${WORKER_LABEL_PREFIX}${candidate.toolName}`,
        parent: agent,
        prompt,
        signal: exec.signal,
        profile,
      });
      const durationMs = Date.now() - startedAt;
      counters.increment("durationMsTotal", durationMs);

      if (outcome.kind !== "completed") {
        counters.increment("failed");
        counters.increment("fallbacks");
        const detail = describeFailure(outcome);
        logger.warn("offload.worker_failed", {
          tool: candidate.toolName,
          worker: route.worker,
          kind: outcome.kind,
          detail,
          durationMs,
        });
        return applyFallback(downstream, candidate, config, detail);
      }

      const validation = validateWorkerOutput(outcome.outputText, candidate.byteLength, config.validation);
      if (!validation.ok) {
        counters.increment("failed");
        counters.increment("fallbacks");
        logger.warn("offload.output_rejected", {
          tool: candidate.toolName,
          worker: route.worker,
          reason: validation.reason,
          inputBytes: candidate.byteLength,
          outputBytes: byteLength(outcome.outputText),
          durationMs,
        });
        return applyFallback(downstream, candidate, config, `output rejected: ${validation.reason}`);
      }

      const outputBytes = byteLength(validation.text);
      counters.increment("completed");
      counters.increment("outputBytes", outputBytes);
      counters.increment("estimatedOutputTokens", estimateTokens(validation.text));
      const derived = deriveOffloadMetrics(counters.snapshot());
      logger.info("offload.completed", {
        tool: candidate.toolName,
        worker: route.worker,
        model: profile.model,
        inputBytes: candidate.byteLength,
        outputBytes,
        reduction: Number(derived.reductionRatio.toFixed(3)),
        estimatedTokensSaved: derived.estimatedTokensSaved,
        durationMs,
      });
      const text = config.annotation.enabled ? `${OFFLOAD_ANNOTATION_MARKER}\n${validation.text}` : validation.text;
      return { kind: "accept", content: [{ type: "text", text }] };
    } catch (error) {
      if (attemptStarted) counters.increment("failed");
      logger.warn("offload.pipeline_failed", {
        tool: exec.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return downstream;
    } finally {
      if (attemptStarted) {
        globalGate.release();
        if (exec.agent) agentGate.release(sessionKey(exec.agent));
      }
    }
  };
}

function skip(
  counters: OffloadCounters,
  logger: PluginLoggerLike,
  config: ResolvedToolOffloadConfig,
  tool: string,
  downstream: PostToolDecision,
  reason: SkipReason,
): PostToolDecision {
  counters.increment("passthrough");
  counters.recordReason(reason);
  if (config.telemetry.enabled) logger.debug("offload.skipped", { tool, reason });
  return downstream;
}

function applyFallback(
  downstream: PostToolDecision,
  candidate: OffloadCandidate,
  config: ResolvedToolOffloadConfig,
  detail: string,
): PostToolDecision {
  const text = buildFallbackText(config.fallback.mode, candidate.contentText, detail, config.validation.maxOutputBytes);
  if (text === null) return downstream;
  return { kind: "accept", content: [{ type: "text", text }] };
}

/**
 * Recursion guard: delegated child sessions (any provider, any label) never
 * get offloading. Structural read keeps `dsh-agent`/`dsh-session` out of the
 * peer set; drift degrades to "not a delegated child", which is safe because
 * our own workers carry no tools (SPEC §25).
 */
function isDelegatedChild(agent: NonNullable<ToolExecution["agent"]>): boolean {
  const header = (agent as { session?: { header?: { origin?: unknown } } }).session?.header;
  return header?.origin === "subagent";
}

function sessionKey(agent: NonNullable<ToolExecution["agent"]>): string {
  const id = (agent as { session?: { id?: unknown } }).session?.id;
  return typeof id === "string" ? id : "unknown";
}

function resolvePromptJob(name: string, config: ResolvedToolOffloadConfig): string {
  return config.prompts[name] ?? BUNDLED_PROMPT_PROFILES[name] ?? BUNDLED_PROMPT_PROFILES.generic!;
}

function describeFailure(outcome: WorkerOutcome): string {
  if (outcome.kind === "unavailable" || outcome.kind === "failed") return outcome.detail;
  return outcome.kind;
}
