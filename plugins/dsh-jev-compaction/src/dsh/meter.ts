/**
 * Pressure measurement over `ctx.tokenMeter` (SPEC §6.2, §8).
 *
 * The primary pressure decision uses DSH token measurement. The model context
 * window is resolved best-effort through the routed request header; when the
 * adapter does not advertise a capacity, `contextWindow`/`ratio` stay
 * `undefined` and the trigger falls back to absolute token thresholds.
 */

import type { Session } from "@deepseek-ai/dsh-session";
import type {
  LlmRuntimeLike,
  PressureSnapshot,
  TokenMeterLike,
} from "./types.js";

/** Routed request header view (structural subset of the session API). */
interface RequestHeaderLike {
  config: { provider?: string; model?: string };
}

function routedTarget(
  session: Session,
): { provider: string; model: string } | undefined {
  const header = (
    session as unknown as {
      requestHeader?: () => RequestHeaderLike | undefined;
    }
  ).requestHeader?.();
  const provider = header?.config.provider;
  const model = header?.config.model;
  if (typeof provider !== "string" || provider.length === 0) return undefined;
  if (typeof model !== "string" || model.length === 0) return undefined;
  return { provider, model };
}

/**
 * Measure the current session pressure. Never throws on capacity lookup
 * failures — an unresolvable window degrades the snapshot, it does not fail
 * the run (SPEC §4 fail-open).
 */
export async function measurePressure(
  session: Session,
  tokenMeter: TokenMeterLike,
  llm: LlmRuntimeLike | undefined,
  signal: AbortSignal | undefined,
): Promise<PressureSnapshot> {
  const measurement = tokenMeter.measure(session);
  const snapshot: PressureSnapshot = {
    estimatedSurfaceTokens: measurement.surfaceTokens,
    totalTokens: measurement.totalTokens,
  };
  const target = routedTarget(session);
  if (target !== undefined && llm !== undefined) {
    try {
      const info = await llm.resolveModelInfo(
        target.provider,
        target.model,
        signal,
      );
      const contextWindow = info.context?.contextWindow;
      if (typeof contextWindow === "number" && contextWindow > 0) {
        snapshot.contextWindow = contextWindow;
        snapshot.ratio = measurement.totalTokens / contextWindow;
      }
    } catch {
      // Capacity stays unknown; the trigger falls back to absolute tokens.
    }
  }
  return snapshot;
}

/** Newest-token pin window: per-node heuristic prices from the meter. */
export function surfaceNodeTokens(
  tokenMeter: TokenMeterLike,
  session: Session,
): Map<number, number> {
  const tokens = new Map<number, number>();
  try {
    for (const node of tokenMeter.measure(session).nodes) {
      tokens.set(node.seq, node.heuristicTokens);
    }
  } catch {
    // No per-node pricing available; the recent-tokens pin degrades to
    // the position pin only.
  }
  return tokens;
}
