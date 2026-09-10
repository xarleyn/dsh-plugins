/**
 * In-memory telemetry counters and derived savings metrics (SPEC §26).
 *
 * Counters are always on (cheap, bounded); the `telemetry.enabled` config
 * only gates structured log emission. Maps are capped so a long-lived host
 * cannot grow them without bound.
 */

const MAX_DIMENSION_KEYS = 128;

export interface OffloadCounterSnapshot {
  /** Results that reached routing. */
  readonly candidates: number;
  /** Started one-shot workers. */
  readonly started: number;
  /** Workers whose validated answer replaced the model-facing content. */
  readonly completed: number;
  /** Started workers that failed, timed out, or were rejected. */
  readonly failed: number;
  /** Routing decisions that kept the original result. */
  readonly passthrough: number;
  /** Fallback applications after a failed attempt. */
  readonly fallbacks: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly durationMsTotal: number;
  /** Skip/failure reason dimension (SPEC §26 dimensions: `reason`). */
  readonly reasons: Readonly<Record<string, number>>;
  /** Tool dimension (SPEC §26 dimensions: `tool`). */
  readonly tools: Readonly<Record<string, number>>;
}

type MutableSnapshot = {
  -readonly [K in keyof OffloadCounterSnapshot]: OffloadCounterSnapshot[K] extends number ? number : Record<string, number>;
};

export class OffloadCounters {
  private readonly state: MutableSnapshot = {
    candidates: 0,
    started: 0,
    completed: 0,
    failed: 0,
    passthrough: 0,
    fallbacks: 0,
    inputBytes: 0,
    outputBytes: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    durationMsTotal: 0,
    reasons: {},
    tools: {},
  };

  increment(field: NumericCounterField, amount = 1): void {
    this.state[field] += amount;
  }

  recordReason(reason: string): void {
    recordDimension(this.state.reasons, reason);
  }

  recordTool(tool: string): void {
    recordDimension(this.state.tools, tool);
  }

  snapshot(): OffloadCounterSnapshot {
    return {
      ...this.state,
      reasons: { ...this.state.reasons },
      tools: { ...this.state.tools },
    };
  }
}

export type NumericCounterField = Exclude<keyof OffloadCounterSnapshot, "reasons" | "tools">;

function recordDimension(map: Record<string, number>, key: string): void {
  // Reserve one slot for the `other` bucket so the total stays capped.
  const normalized = Object.hasOwn(map, key) || Object.keys(map).length < MAX_DIMENSION_KEYS - 1 ? key : "other";
  map[normalized] = (map[normalized] ?? 0) + 1;
}

export interface OffloadDerivedMetrics {
  /** `1 - outputBytes/inputBytes` over completed offloads; 0 when nothing measured. */
  readonly reductionRatio: number;
  readonly avgDurationMs: number;
  /** Share of started workers that produced accepted output. */
  readonly completionRate: number;
  /** Estimated model-facing tokens saved per completed offload. */
  readonly estimatedTokensSaved: number;
}

export function deriveOffloadMetrics(snapshot: OffloadCounterSnapshot): OffloadDerivedMetrics {
  const reductionRatio = snapshot.inputBytes > 0 ? 1 - snapshot.outputBytes / snapshot.inputBytes : 0;
  return {
    reductionRatio: Math.max(0, reductionRatio),
    avgDurationMs: snapshot.completed > 0 ? Math.round(snapshot.durationMsTotal / snapshot.completed) : 0,
    completionRate: snapshot.started > 0 ? snapshot.completed / snapshot.started : 0,
    estimatedTokensSaved: Math.max(0, snapshot.estimatedInputTokens - snapshot.estimatedOutputTokens),
  };
}
