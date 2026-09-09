/**
 * WorkerRunner (SPEC §9.5, §22-§25).
 *
 * The only component that knows the DSH subagent seam. Starts a one-shot
 * `spawn` worker with:
 * - `toolFilter: { allow: [] }` — the worker inherits no model-facing tools
 *   (SPEC §6.1: no authority expansion);
 * - an exact cheap model via `agentOptions` (keys omitted when unset so the
 *   child inherits the parent route, see `resolveChildAgentOptions`);
 * - a merged cancellation signal (parent `exec.signal` + worker timeout).
 *
 * Every failure mode normalizes into a `WorkerOutcome`; nothing throws across
 * the integration seam. `run.dispose()` is always awaited, including on the
 * timeout path, so no child agent outlives the tool call (SPEC §22).
 */

import type { SubagentRun, SubagentStartRequest } from "@deepseek-ai/dsh-subagent";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";

import type { ResolvedWorkerProfile } from "../config.js";

/** Structural surface of `ctx.subagents` consumed by this plugin. */
export interface SubagentsServiceLike {
  start(name: string, request: SubagentStartRequest): Promise<SubagentRun>;
  getProvider(name: string): SubagentProviderLike | undefined;
}

export interface SubagentProviderLike {
  readonly capabilities: { readonly toolFilter: boolean };
}

export interface WorkerRunRequest {
  /** Durable child label; `dsh-tool-offload:<tool>` marks our workers. */
  readonly label: string;
  readonly parent: NonNullable<ToolExecution["agent"]>;
  readonly prompt: string;
  /** Parent cancellation signal (`exec.signal`). */
  readonly signal: AbortSignal;
  readonly profile: ResolvedWorkerProfile;
}

export type WorkerOutcome =
  | { readonly kind: "completed"; readonly outputText: string; readonly stopReason: string }
  | { readonly kind: "aborted" }
  | { readonly kind: "timeout" }
  | { readonly kind: "unavailable"; readonly detail: string }
  | { readonly kind: "failed"; readonly detail: string };

export interface WorkerRunnerLike {
  run(request: WorkerRunRequest): Promise<WorkerOutcome>;
}

/** Label prefix marking worker children of this plugin (SPEC §25). */
export const WORKER_LABEL_PREFIX = "dsh-tool-offload:";

export function createSubagentRunner(subagents: SubagentsServiceLike): WorkerRunnerLike {
  return {
    async run(request: WorkerRunRequest): Promise<WorkerOutcome> {
      const provider = subagents.getProvider(request.profile.subagentProvider);
      if (!provider) {
        return {
          kind: "unavailable",
          detail: `subagent provider "${request.profile.subagentProvider}" is not registered`,
        };
      }
      if (!provider.capabilities.toolFilter) {
        return {
          kind: "unavailable",
          detail: `subagent provider "${request.profile.subagentProvider}" does not support tool restrictions`,
        };
      }
      if (request.signal.aborted) return { kind: "aborted" };

      // The worker timeout is bounded twice: the merged signal cancels the
      // child's turn work, and the belt-and-braces race below guarantees the
      // post-execute seam settles even if the runtime never resolves.
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(request.profile.timeoutMs)]);
      const agentOptions: SubagentStartRequest["agentOptions"] = {};
      if (request.profile.provider !== null) agentOptions.provider = request.profile.provider;
      if (request.profile.model !== null) agentOptions.model = request.profile.model;
      if (request.profile.maxTokens !== null) agentOptions.maxTokens = request.profile.maxTokens;

      let run: SubagentRun;
      try {
        run = await subagents.start(request.profile.subagentProvider, {
          label: request.label,
          parent: request.parent,
          prompt: [{ type: "text", text: request.prompt }],
          signal,
          agentOptions,
          toolFilter: { allow: [] },
        });
      } catch (error) {
        return mapStartupFailure(request, error);
      }

      let timer: NodeJS.Timeout | undefined;
      try {
        const result = await Promise.race([
          run.result,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("worker-timeout-belt")), request.profile.timeoutMs);
            timer.unref?.();
          }),
        ]);
        const outputText = joinTextBlocks(result.output);
        if (result.stopReason === "completed") {
          return { kind: "completed", outputText, stopReason: result.stopReason };
        }
        if (result.stopReason === "aborted") {
          return request.signal.aborted ? { kind: "aborted" } : { kind: "timeout" };
        }
        return {
          kind: "failed",
          detail: `worker stopped with reason "${String(result.stopReason)}"${result.diagnostic ? `: ${result.diagnostic}` : ""}`,
        };
      } catch {
        return request.signal.aborted ? { kind: "aborted" } : { kind: "timeout" };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        await run.dispose();
      }
    },
  };
}

function mapStartupFailure(request: WorkerRunRequest, error: unknown): WorkerOutcome {
  if (request.signal.aborted) return { kind: "aborted" };
  return { kind: "failed", detail: error instanceof Error ? error.message : String(error) };
}

interface TextBlockLike {
  readonly type: unknown;
  readonly text?: unknown;
}

export function joinTextBlocks(output: readonly unknown[]): string {
  const parts: string[] = [];
  for (const block of output) {
    const record = block as TextBlockLike;
    if (record?.type === "text" && typeof record.text === "string") parts.push(record.text);
  }
  return parts.join("\n").trim();
}
