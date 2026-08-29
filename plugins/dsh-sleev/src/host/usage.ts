import type { TokenUsage } from "@deepseek-ai/dsh-llm";
import type {
  DerivedUsageTelemetry,
  ProviderUsageTelemetry,
} from "../shared/telemetry.js";

/** Normalize optional cache buckets while preserving disjoint semantics. */
export function normalizeUsage(usage: TokenUsage): ProviderUsageTelemetry {
  return Object.freeze({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    ...(usage.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: usage.reasoningTokens }),
  });
}

/** Compute effective provider input as uncached + cache reads + cache writes. */
export function deriveUsage(
  usage: ProviderUsageTelemetry,
): DerivedUsageTelemetry {
  return Object.freeze({
    effectiveInputTokens:
      usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
  });
}
