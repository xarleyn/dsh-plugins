/**
 * Structural mirror of the DSH stream chunk union (design SPEC §10, §33).
 *
 * The guard core works against this local structural type so it stays
 * unit-testable without the DSH runtime; the host entry point passes real
 * `llm/stream` chunks, which are structurally compatible.
 */

export interface BlockStartChunk {
  readonly type: "block-start";
  readonly index: number;
  readonly blockType: string;
}

export interface TextDeltaChunk {
  readonly type: "text-delta";
  readonly index: number;
  readonly text: string;
}

export interface ReasoningDeltaChunk {
  readonly type: "reasoning-delta";
  readonly index: number;
  readonly text: string;
}

export interface ToolCallDeltaChunk {
  readonly type: "tool-call-delta";
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly argumentsDelta: string;
}

export interface BlockEndChunk {
  readonly type: "block-end";
  readonly index: number;
  readonly block: unknown;
}

export interface UsageChunk {
  readonly type: "usage";
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
    readonly reasoningTokens?: number;
  };
}

export interface FinishChunk {
  readonly type: "finish";
  readonly reason:
    | { readonly kind: "stop" }
    | { readonly kind: "tool-calls" }
    | { readonly kind: "max-tokens" }
    | { readonly kind: "aborted"; readonly failure: StreamFailure }
    | { readonly kind: "error"; readonly failure: StreamFailure };
  readonly replayState?: unknown;
}

export interface StreamFailure {
  readonly message: string;
  readonly code?: string;
  readonly name?: string;
}

export type StreamChunk =
  | BlockStartChunk
  | TextDeltaChunk
  | ReasoningDeltaChunk
  | ToolCallDeltaChunk
  | BlockEndChunk
  | UsageChunk
  | FinishChunk;

export type DeltaChunk = TextDeltaChunk | ReasoningDeltaChunk;

export function isDeltaChunk(chunk: StreamChunk): chunk is DeltaChunk {
  return chunk.type === "text-delta" || chunk.type === "reasoning-delta";
}

/** Synthetic terminal chunk used when the guard stops a generation. */
export function blockedFinish(failure: StreamFailure): FinishChunk {
  return { type: "finish", reason: { kind: "error", failure } };
}
