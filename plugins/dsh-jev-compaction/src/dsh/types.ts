/**
 * Normalized internal types and structural host views.
 *
 * Everything outside `src/dsh/` operates on these types only — DSH
 * event/event-map shapes never leak into the planner, the Jev client, or the
 * mutation renderer (SPEC §24). Host services (`tokenMeter`, `llm`,
 * `commands`) are viewed through structural interfaces at the registration
 * seam, the established repo convention for host-only plugins.
 */

import type { Session } from "@deepseek-ai/dsh-session";

/** The agent object this plugin touches: identity plus its session. */
export interface AgentLike {
  readonly id: unknown;
  readonly session: Session;
}

/** Structural subset of the `agent/pre-step` payload used by the plugin. */
export interface PreStepPayload {
  readonly agent: AgentLike;
  readonly turn: number;
  readonly step: number;
  readonly signal: AbortSignal;
}

/** Structural subset of the waterfall decision. */
export type PreStepDecisionStruct =
  | { readonly kind: "reject" }
  | { readonly kind: "enter"; readonly messages: unknown };

/** Structural view of the host context used at the registration seam. */
export interface JevHostContext {
  on(
    event: string,
    listener: (
      payload: PreStepPayload,
      next: () => Promise<PreStepDecisionStruct>,
    ) => Promise<PreStepDecisionStruct>,
    options?: unknown,
  ): () => void;
  inject(
    services: readonly string[],
    fn: (ctx: JevInjectedContext) => void,
  ): void;
}

/** Structural views of the host services the plugin consumes. */
export interface JevInjectedContext {
  commands: {
    register(definition: {
      name: string;
      description: string;
      input?: { hint: string };
      handler(
        invocation: CommandInvocation,
      ): CommandResult | Promise<CommandResult>;
    }): unknown;
  };
}

/** Structural subset of a command invocation (host contract). */
export interface CommandInvocation {
  readonly commandId: unknown;
  readonly agent: AgentLike;
  readonly rawInput: string;
  readonly signal: AbortSignal;
}

/** Structural subset of the command result (host contract). */
export type CommandResult =
  | { readonly kind: "success"; readonly text?: string }
  | { readonly kind: "error"; readonly text: string };

/** Structural view of `ctx.tokenMeter`. */
export interface TokenMeterLike {
  measure(session: Session): TokenMeasurementLike;
  estimateMessage(message: unknown): number;
}

/** Structural subset of the token measurement. */
export interface TokenMeasurementLike {
  readonly totalTokens: number;
  readonly surfaceTokens: number;
  readonly nodes: readonly {
    readonly seq: number;
    readonly heuristicTokens: number;
  }[];
}

/** Structural view of `ctx.llm` (optional capability for capacity lookup). */
export interface LlmRuntimeLike {
  resolveModelInfo(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<{ context?: { contextWindow: number } }>;
}

/** Pressure snapshot exposed to the trigger policy (SPEC §8). */
export interface PressureSnapshot {
  /** Estimated tokens of the current surface. */
  estimatedSurfaceTokens: number;
  /** Estimated total pressure (baseline + surface), when measurable. */
  totalTokens?: number;
  /** Routed model context window, when advertised. */
  contextWindow?: number;
  /** totalTokens / contextWindow, when both are known. */
  ratio?: number;
}
