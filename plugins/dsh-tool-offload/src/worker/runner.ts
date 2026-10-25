/**
 * WorkerRunner (SPEC §9.5, §22-§25).
 *
 * The only component that knows the DSH subagent seam. Starts a one-shot
 * `spawn` worker through `startActivation` with:
 * - `agentPreset` from the worker profile — the Host composes a child's tools
 *   from its Agent Preset, and the start contract carries no per-run tool
 *   filter any more, so a preset that mounts no model-facing tools is the only
 *   way to keep the worker tool-free (SPEC §6.1: no authority expansion). A
 *   profile that names no preset refuses to start instead of handing the child
 *   the parent's tools;
 * - an exact cheap model via `agentOptions` (keys omitted when unset so the
 *   child inherits the parent route, see `resolveChildAgentOptions`); an
 *   unset pair follows the QA policy of the chat the tool result came from,
 *   when the deployment has one;
 * - a merged cancellation signal (parent `exec.signal` + worker timeout).
 *
 * Every failure mode normalizes into a `WorkerOutcome`; nothing throws across
 * the integration seam. `activation.dispose()` is always awaited, including on
 * the timeout path, so no child agent outlives the tool call (SPEC §22).
 */

import type {
  SubagentActivation,
  SubagentActivationSpec,
  SubagentProvider,
} from "@deepseek-ai/dsh-subagent";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";

import type { ResolvedWorkerProfile } from "../config.js";
import type { QaModelPolicyPair } from "../qa-policy.js";

/** Structural surface of `ctx.subagents` consumed by this plugin. */
export interface SubagentsServiceLike {
  startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>;
  getProvider(name: string): SubagentProvider | undefined;
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
  | {
      readonly kind: "completed";
      readonly outputText: string;
      readonly stopReason: string;
    }
  | { readonly kind: "aborted" }
  | { readonly kind: "timeout" }
  | { readonly kind: "unavailable"; readonly detail: string }
  | { readonly kind: "failed"; readonly detail: string };

export interface WorkerRunnerLike {
  run(request: WorkerRunRequest): Promise<WorkerOutcome>;
}

/** Label prefix marking worker children of this plugin (SPEC §25). */
export const WORKER_LABEL_PREFIX = "dsh-tool-offload:";

export function createSubagentRunner(
  subagents: SubagentsServiceLike,
  /**
   * The QA policy of one chat, asked by session id. A worker profile that names
   * no model then follows the policy of the role the chat runs under rather than
   * the model its visitor picked — the delegation answers to the same pair the
   * chat was opened on.
   */
  modelPolicy?: (sessionId: string) => QaModelPolicyPair | undefined,
): WorkerRunnerLike {
  return {
    async run(request: WorkerRunRequest): Promise<WorkerOutcome> {
      const provider = subagents.getProvider(request.profile.subagentProvider);
      if (!provider) {
        return {
          kind: "unavailable",
          detail: `subagent provider "${request.profile.subagentProvider}" is not registered`,
        };
      }
      // SPEC §6.1: the worker inherits no model-facing tools. The start
      // contract carries no per-run tool filter any more — a child's tool
      // composition comes from its Agent Preset, and a request without one
      // joins the parent's current generation. Starting an unfiltered worker
      // would hand the child the parent's tools, so a profile that names no
      // preset refuses to start and the tool result falls through unchanged.
      const agentPreset = request.profile.agentPreset;
      if (agentPreset === null) {
        return {
          kind: "unavailable",
          detail: `worker profile names no agentPreset: the Host composes a child's tools from its Agent Preset and accepts no per-run tool filter, so a worker without one would inherit the parent's tool composition; configure workers.<name>.agentPreset with a preset that mounts no model-facing tools`,
        };
      }
      if (!provider.capabilities.agentPreset) {
        return {
          kind: "unavailable",
          detail: `subagent provider "${request.profile.subagentProvider}" does not support independent agent presets`,
        };
      }
      if (request.signal.aborted) return { kind: "aborted" };

      // The worker timeout is bounded twice: the merged signal cancels the
      // child's turn work, and the belt-and-braces race below guarantees the
      // post-execute seam settles even if the runtime never resolves.
      const signal = AbortSignal.any([
        request.signal,
        AbortSignal.timeout(request.profile.timeoutMs),
      ]);
      const agentOptions: NonNullable<
        SubagentActivationSpec["request"]["agentOptions"]
      > = {};
      // A profile that pins no model follows the policy of the chat this tool
      // result came from, rather than the model that chat happens to be on.
      const policy =
        request.profile.model === null
          ? modelPolicy?.(String(request.parent.session.id))
          : undefined;
      const modelProvider = request.profile.provider ?? policy?.provider;
      const modelId = request.profile.model ?? policy?.model;
      if (modelProvider !== undefined) agentOptions.provider = modelProvider;
      if (modelId !== undefined) agentOptions.model = modelId;
      if (request.profile.maxTokens !== null)
        agentOptions.maxTokens = request.profile.maxTokens;

      let activation: SubagentActivation;
      try {
        activation = await subagents.startActivation({
          provider: request.profile.subagentProvider,
          label: request.label,
          request: {
            prompt: [{ type: "text", text: request.prompt }],
            parent: request.parent,
            agentOptions,
            agentPreset,
          },
          signal,
          // Caller delivery returns the result to this call alone: the worker
          // answers through the replaced tool content, so the parent model
          // must not be notified of the child.
          delivery: "caller",
        });
      } catch (error) {
        return mapStartupFailure(request, error);
      }

      let timer: NodeJS.Timeout | undefined;
      try {
        const result = await Promise.race([
          activation.result,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("worker-timeout-belt")),
              request.profile.timeoutMs,
            );
            timer.unref?.();
          }),
        ]);
        const outputText = joinTextBlocks(result.output);
        if (result.stopReason === "completed") {
          return {
            kind: "completed",
            outputText,
            stopReason: result.stopReason,
          };
        }
        if (result.stopReason === "aborted") {
          return request.signal.aborted
            ? { kind: "aborted" }
            : { kind: "timeout" };
        }
        return {
          kind: "failed",
          detail: `worker stopped with reason "${String(result.stopReason)}"${result.diagnostic ? `: ${result.diagnostic}` : ""}`,
        };
      } catch {
        return request.signal.aborted
          ? { kind: "aborted" }
          : { kind: "timeout" };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        // Teardown failures are reported on the activation itself, not by
        // replacing an already captured result; this seam must not throw.
        await activation.dispose().catch(() => undefined);
      }
    },
  };
}

function mapStartupFailure(
  request: WorkerRunRequest,
  error: unknown,
): WorkerOutcome {
  if (request.signal.aborted) return { kind: "aborted" };
  return {
    kind: "failed",
    detail: error instanceof Error ? error.message : String(error),
  };
}

interface TextBlockLike {
  readonly type: unknown;
  readonly text?: unknown;
}

export function joinTextBlocks(output: readonly unknown[]): string {
  const parts: string[] = [];
  for (const block of output) {
    const record = block as TextBlockLike;
    if (record?.type === "text" && typeof record.text === "string")
      parts.push(record.text);
  }
  return parts.join("\n").trim();
}
