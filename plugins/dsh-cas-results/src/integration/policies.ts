/**
 * Per-tool transformation policies (SPEC §22).
 *
 * The plugin never transforms its own retrieval tools (SPEC §21), tools the
 * user excluded, or tools disabled via per-tool overrides. Everything else
 * gets a fully resolved `TransformPolicy` combining global defaults with the
 * per-tool override block.
 */

import type { ResolvedCasResultsConfig } from "../config.js";
import type { TransformPolicy, PreviewStyle } from "../transform/scan-value.js";

/** All model-facing tools of this plugin bypass CAS transformation (SPEC §21). */
export const OWN_TOOL_PREFIX = "dsh_cas_";

export function isOwnToolName(toolName: string): boolean {
  return toolName.startsWith(OWN_TOOL_PREFIX);
}

export function isToolExcluded(config: ResolvedCasResultsConfig, toolName: string): boolean {
  return config.excludeTools.includes(toolName);
}

/**
 * Resolve the effective policy for one tool. Returns `null` when the tool
 * must pass through untouched.
 */
export function resolveToolPolicy(config: ResolvedCasResultsConfig, toolName: string): TransformPolicy | null {
  if (isOwnToolName(toolName) || isToolExcluded(config, toolName)) return null;
  const override = config.tools[toolName];
  if (override?.disabled === true) return null;

  const base64Enabled = override?.base64 ?? config.base64.enabled;
  const thresholdOverride = override?.thresholdBytes;
  const style: PreviewStyle = override?.preview ?? "auto";

  return {
    toolName,
    thresholds: {
      textBytes: thresholdOverride ?? config.thresholds.textBytes,
      htmlBytes: thresholdOverride ?? config.thresholds.htmlBytes,
      logBytes: thresholdOverride ?? config.thresholds.logBytes,
    },
    base64: {
      enabled: base64Enabled,
      minChars: config.base64.minChars,
      requireStrongDetection: config.base64.requireStrongDetection,
    },
    preview: {
      maxChars: config.preview.maxChars,
      keepHeadLines: config.preview.keepHeadLines,
      keepTailLines: config.preview.keepTailLines,
      keepPatterns: config.preview.keepPatterns,
    },
    previewStyle: style,
  };
}
