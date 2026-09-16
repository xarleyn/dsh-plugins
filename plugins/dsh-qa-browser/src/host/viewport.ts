import type { BrowserViewport } from "../types.js";

/**
 * Deployment bounds for a tab's emulated viewport. One home for both callers
 * that may resize a tab — the agent's `browser_viewport` tool and the QA
 * panel's device controls — so a browser chrome cannot reach a size the model
 * is not allowed to ask for.
 */
export const VIEWPORT_BOUNDS = {
  width: { min: 320, max: 7_680 },
  height: { min: 240, max: 4_320 },
  deviceScaleFactor: { min: 0.5, max: 4 },
} as const;

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampScale(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Fold a requested size into the deployment's bounds. Omitted fields keep the
 * caller's current value, so a caller that only resizes the width does not have
 * to restate (or guess) the device scale factor.
 */
export function clampViewport(
  requested: {
    readonly width?: number;
    readonly height?: number;
    readonly deviceScaleFactor?: number;
  },
  base: BrowserViewport,
): BrowserViewport {
  return {
    width: clampInteger(
      requested.width ?? base.width,
      VIEWPORT_BOUNDS.width.min,
      VIEWPORT_BOUNDS.width.max,
    ),
    height: clampInteger(
      requested.height ?? base.height,
      VIEWPORT_BOUNDS.height.min,
      VIEWPORT_BOUNDS.height.max,
    ),
    deviceScaleFactor: clampScale(
      requested.deviceScaleFactor ?? base.deviceScaleFactor,
      VIEWPORT_BOUNDS.deviceScaleFactor.min,
      VIEWPORT_BOUNDS.deviceScaleFactor.max,
    ),
  };
}
