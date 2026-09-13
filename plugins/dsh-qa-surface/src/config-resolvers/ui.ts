import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";
import { assertIntInRange } from "./shared.js";

type UiSlice = ResolvedQaSurfaceConfig["ui"];

/** Resolve the UI domain: widget visibility and the content width bound. */
export function resolveUi(input: QaSurfaceConfig): UiSlice {
  const maxContentWidth =
    input.ui?.maxContentWidth ?? DEFAULT_QA_SURFACE_CONFIG.ui.maxContentWidth;
  assertIntInRange("ui.maxContentWidth", maxContentWidth, 480, 1600);
  return Object.freeze({
    showHeader: input.ui?.showHeader ?? DEFAULT_QA_SURFACE_CONFIG.ui.showHeader,
    showReset: input.ui?.showReset ?? DEFAULT_QA_SURFACE_CONFIG.ui.showReset,
    showStop: input.ui?.showStop ?? DEFAULT_QA_SURFACE_CONFIG.ui.showStop,
    showTimestamps:
      input.ui?.showTimestamps ?? DEFAULT_QA_SURFACE_CONFIG.ui.showTimestamps,
    showToolActivity:
      input.ui?.showToolActivity ??
      DEFAULT_QA_SURFACE_CONFIG.ui.showToolActivity,
    showReasoning:
      input.ui?.showReasoning ?? DEFAULT_QA_SURFACE_CONFIG.ui.showReasoning,
    renderMarkdown:
      input.ui?.renderMarkdown ?? DEFAULT_QA_SURFACE_CONFIG.ui.renderMarkdown,
    maxContentWidth,
    showSessionList:
      input.ui?.showSessionList ?? DEFAULT_QA_SURFACE_CONFIG.ui.showSessionList,
  });
}
