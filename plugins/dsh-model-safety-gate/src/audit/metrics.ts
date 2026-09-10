/**
 * Process-lifetime safety counters (design SPEC §29).
 *
 * Plain monotonic counters — no timers, no exports, no background work. The
 * snapshot is a plain object so the host service and future UI can read it
 * without touching internals.
 */

export interface SafetyMetricsSnapshot {
  readonly checks: { readonly input: number; readonly text: number; readonly reasoning: number; readonly tool: number; readonly "tool-result": number };
  readonly blocks: { readonly input: number; readonly output: number; readonly reasoning: number; readonly tools: number; readonly "tool-results": number };
  readonly warns: number;
  readonly classifierRequests: number;
  readonly classifierErrors: number;
  readonly classifierInputTokens: number;
  readonly classifierOutputTokens: number;
  readonly classifierLatencyTotalMs: number;
  readonly classifierLatencyMaxMs: number;
  readonly bufferOverflows: number;
  readonly mainOutputCharsQuarantined: number;
  readonly estimatedMainTokensPrevented: number;
}

export class SafetyMetrics {
  private checks: Record<"input" | "text" | "reasoning" | "tool" | "tool-result", number> = { input: 0, text: 0, reasoning: 0, tool: 0, "tool-result": 0 };
  private blocks: Record<"input" | "output" | "reasoning" | "tools" | "tool-results", number> = { input: 0, output: 0, reasoning: 0, tools: 0, "tool-results": 0 };
  private warns = 0;
  private classifierRequests = 0;
  private classifierErrors = 0;
  private classifierInputTokens = 0;
  private classifierOutputTokens = 0;
  private classifierLatencyTotalMs = 0;
  private classifierLatencyMaxMs = 0;
  private bufferOverflows = 0;
  private mainOutputCharsQuarantined = 0;
  private estimatedMainTokensPrevented = 0;

  recordCheck(channel: keyof SafetyMetricsSnapshot["checks"]): void {
    this.checks[channel] += 1;
  }

  recordBlock(bucket: keyof SafetyMetricsSnapshot["blocks"]): void {
    this.blocks[bucket] += 1;
  }

  recordWarn(): void {
    this.warns += 1;
  }

  recordClassifierCall(usage: { inputTokens: number; outputTokens: number } | null, latencyMs: number): void {
    this.classifierRequests += 1;
    this.classifierLatencyTotalMs += latencyMs;
    this.classifierLatencyMaxMs = Math.max(this.classifierLatencyMaxMs, latencyMs);
    if (usage !== null) {
      this.classifierInputTokens += usage.inputTokens;
      this.classifierOutputTokens += usage.outputTokens;
    }
  }

  recordClassifierError(): void {
    this.classifierErrors += 1;
  }

  recordBufferOverflow(): void {
    this.bufferOverflows += 1;
  }

  recordQuarantinedChars(chars: number): void {
    this.mainOutputCharsQuarantined += chars;
  }

  /** Rough savings from early cancellation: chars that never got generated / 4. */
  recordPreventedOutput(chars: number): void {
    this.estimatedMainTokensPrevented += Math.ceil(chars / 4);
  }

  snapshot(): SafetyMetricsSnapshot {
    return {
      checks: { ...this.checks },
      blocks: { ...this.blocks },
      warns: this.warns,
      classifierRequests: this.classifierRequests,
      classifierErrors: this.classifierErrors,
      classifierInputTokens: this.classifierInputTokens,
      classifierOutputTokens: this.classifierOutputTokens,
      classifierLatencyTotalMs: this.classifierLatencyTotalMs,
      classifierLatencyMaxMs: this.classifierLatencyMaxMs,
      bufferOverflows: this.bufferOverflows,
      mainOutputCharsQuarantined: this.mainOutputCharsQuarantined,
      estimatedMainTokensPrevented: this.estimatedMainTokensPrevented,
    };
  }
}
