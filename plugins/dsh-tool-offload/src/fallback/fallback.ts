/**
 * FallbackHandler (SPEC §9.7).
 *
 * `original` (the default) keeps the untouched downstream decision —
 * handled by the caller returning it. `truncate` deterministically bounds
 * the original text. `error` surfaces the offload failure as the content.
 */

import { truncateMiddle } from "../utils/text.js";
import type { ResolvedToolOffloadConfig } from "../config.js";

export type FallbackMode = ResolvedToolOffloadConfig["fallback"]["mode"];

/**
 * Replacement content for a failed offload. Returns `null` for the
 * `original` mode: the caller then returns the downstream decision as-is.
 */
export function buildFallbackText(mode: FallbackMode, originalText: string, failureDetail: string, maxBytes: number): string | null {
  switch (mode) {
    case "original":
      return null;
    case "truncate":
      return [
        `[dsh-tool-offload] worker offload failed (${failureDetail}); showing the bounded original:`,
        truncateMiddle(originalText, maxBytes),
      ].join("\n");
    case "error":
      return `[dsh-tool-offload] worker offload failed: ${failureDetail}. Original result withheld by fallback mode "error".`;
  }
}
