/** Stable request classification used by host metrics and future clients. */
export type RequestKind =
  "agent" | "compaction" | "session-title" | "one-shot" | "unknown";

/** Provider-reported disjoint token buckets. */
export interface ProviderUsageTelemetry {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens?: number;
}

/** Derived wire-boundary token-volume metrics. */
export interface DerivedUsageTelemetry {
  readonly effectiveInputTokens: number;
}

/** Terminal result of one observed model call. */
export type CallResult =
  | { readonly kind: "success" }
  | { readonly kind: "error"; readonly code?: string }
  | { readonly kind: "aborted" };

/** Secret-free telemetry for one request routed through an optimizer alias. */
export interface OptimizerCallTelemetry {
  readonly schemaVersion: 1;
  readonly callId: string;
  readonly sessionId?: string;
  readonly kind: RequestKind;
  readonly provider: string;
  readonly model: string;
  readonly optimizer: "sleev";
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly providerUsage?: ProviderUsageTelemetry;
  readonly derived?: DerivedUsageTelemetry;
  readonly result: CallResult;
}
