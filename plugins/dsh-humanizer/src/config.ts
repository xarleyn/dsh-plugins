import z from "@deepseek-ai/schemastery";

/** Operator-owned configuration; tools cannot choose a destination. */
export interface HumanizerConfig {
  /** Register tools; false leaves no tools or network activity. */
  readonly enabled?: boolean;
  /** Bare HTTP(S) origin of a dedicated Humanizer llama-server. */
  readonly endpoint?: string;
  /** Bearer key; empty falls back to DSH_HUMANIZER_API_KEY. */
  readonly apiKey?: string;
  /** Overall budget for one tool call, including all chunks (1000-900000 ms). */
  readonly timeoutMs?: number;
  /** Total draft byte limit (1024-262144). */
  readonly maxInputBytes?: number;
  /** Paragraph group byte limit (256-16384). */
  readonly maxChunkBytes?: number;
  /** Reserved generation tokens per group (128-4096). */
  readonly maxOutputTokens?: number;
  /** Total output byte limit (1024-524288). */
  readonly maxOutputBytes?: number;
}

export interface ResolvedHumanizerConfig {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
  readonly maxChunkBytes: number;
  readonly maxOutputTokens: number;
  readonly maxOutputBytes: number;
}

export const DEFAULTS: ResolvedHumanizerConfig = {
  enabled: true,
  endpoint: "http://127.0.0.1:8080",
  apiKey: "",
  timeoutMs: 120_000,
  maxInputBytes: 65_536,
  maxChunkBytes: 6_000,
  maxOutputTokens: 2048,
  maxOutputBytes: 131_072,
};

function limit(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(min, Math.min(max, Math.floor(raw)))
    : fallback;
}

export function resolveConfig(
  raw: HumanizerConfig = {},
): ResolvedHumanizerConfig {
  let endpoint: URL;
  try {
    endpoint = new URL(raw.endpoint?.trim() || DEFAULTS.endpoint);
  } catch {
    throw new TypeError(
      "dsh-humanizer: endpoint must be a bare HTTP(S) origin.",
    );
  }
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new TypeError(
      "dsh-humanizer: endpoint must be a bare HTTP(S) origin without credentials.",
    );
  }
  const apiKey = (
    raw.apiKey?.trim() ||
    process.env["DSH_HUMANIZER_API_KEY"] ||
    ""
  ).trim();
  if (/[\r\n]/u.test(apiKey))
    throw new TypeError("dsh-humanizer: invalid API key.");
  const maxInputBytes = limit(
    raw.maxInputBytes,
    DEFAULTS.maxInputBytes,
    1024,
    262144,
  );
  return {
    enabled: raw.enabled !== false,
    endpoint: endpoint.origin,
    apiKey,
    timeoutMs: limit(raw.timeoutMs, DEFAULTS.timeoutMs, 1000, 900000),
    maxInputBytes,
    maxChunkBytes: Math.min(
      maxInputBytes,
      limit(raw.maxChunkBytes, DEFAULTS.maxChunkBytes, 256, 16384),
    ),
    maxOutputTokens: limit(
      raw.maxOutputTokens,
      DEFAULTS.maxOutputTokens,
      128,
      4096,
    ),
    maxOutputBytes: limit(
      raw.maxOutputBytes,
      DEFAULTS.maxOutputBytes,
      1024,
      524288,
    ),
  };
}

export const Config: z<HumanizerConfig> = z
  .object({
    enabled: z
      .boolean()
      .default(DEFAULTS.enabled)
      .description("Register Humanizer tools."),
    endpoint: z
      .string()
      .default(DEFAULTS.endpoint)
      .description(
        "Dedicated llama-server HTTP(S) origin; no path or credentials.",
      ),
    apiKey: z
      .string()
      .default("")
      .description("Bearer key; empty uses DSH_HUMANIZER_API_KEY."),
    timeoutMs: z
      .number()
      .default(DEFAULTS.timeoutMs)
      .description("Overall tool timeout in milliseconds (1000-900000)."),
    maxInputBytes: z
      .number()
      .default(DEFAULTS.maxInputBytes)
      .description("Maximum draft UTF-8 bytes (1024-262144)."),
    maxChunkBytes: z
      .number()
      .default(DEFAULTS.maxChunkBytes)
      .description("Maximum paragraph group UTF-8 bytes (256-16384)."),
    maxOutputTokens: z
      .number()
      .default(DEFAULTS.maxOutputTokens)
      .description("Reserved generation tokens per group (128-4096)."),
    maxOutputBytes: z
      .number()
      .default(DEFAULTS.maxOutputBytes)
      .description("Maximum total rewrite UTF-8 bytes (1024-524288)."),
  })
  .description("Humanizer text rewriting tools.");
