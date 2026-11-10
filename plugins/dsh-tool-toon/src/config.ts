import z from "@deepseek-ai/schemastery";

export interface ToolToonConfig {
  /** Installing the plugin opts in; false bypasses formatting entirely. */
  readonly enabled?: boolean;
  /** Minimum input text size in UTF-8 bytes. */
  readonly minBytes?: number;
  /** Maximum input text size processed synchronously. */
  readonly maxBytes?: number;
  /** Minimum absolute saving versus original text and compact JSON. */
  readonly minSavingsBytes?: number;
  /** Minimum proportional saving, including the TOON fence. */
  readonly minSavingsRatio?: number;
  /** Exact tool names whose output must remain unchanged. */
  readonly excludeTools?: string[];
}

export interface ResolvedToolToonConfig {
  readonly enabled: boolean;
  readonly minBytes: number;
  readonly maxBytes: number;
  readonly minSavingsBytes: number;
  readonly minSavingsRatio: number;
  readonly excludeTools: readonly string[];
}

export const ToolToonConfigSchema: z<ToolToonConfig> = z.object({
  enabled: z
    .boolean()
    .default(true)
    .description("Format JSON tool responses as TOON when smaller."),
  minBytes: z
    .number()
    .default(512)
    .description("Minimum input size in UTF-8 bytes."),
  maxBytes: z
    .number()
    .default(262144)
    .description("Maximum input size in UTF-8 bytes."),
  minSavingsBytes: z
    .number()
    .default(96)
    .description("Minimum UTF-8 bytes saved versus compact JSON."),
  minSavingsRatio: z
    .number()
    .default(0.15)
    .description("Minimum fraction of UTF-8 bytes saved, from 0 to 0.9."),
  excludeTools: z
    .array(z.string())
    .default([])
    .description("Exact tool names to bypass."),
});

function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function resolveToolToonConfig(
  raw: ToolToonConfig = {},
): ResolvedToolToonConfig {
  const maxBytes = Math.floor(bounded(raw.maxBytes, 262144, 512, 1048576));
  return {
    enabled: raw.enabled !== false,
    minBytes: Math.floor(bounded(raw.minBytes, 512, 0, maxBytes)),
    maxBytes,
    minSavingsBytes: Math.floor(bounded(raw.minSavingsBytes, 96, 1, maxBytes)),
    minSavingsRatio: bounded(raw.minSavingsRatio, 0.15, 0, 0.9),
    excludeTools: [
      ...new Set(
        (raw.excludeTools ?? []).filter(
          (name) => typeof name === "string" && name.length > 0,
        ),
      ),
    ],
  };
}
