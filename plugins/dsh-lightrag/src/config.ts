/**
 * Configuration surface of the dsh-lightrag plugin.
 *
 * The Schemastery schema (`LightRagConfigSchema`) is the user-facing contract
 * exposed through the Cordis named `Config` export; `resolveLightRagConfig`
 * normalizes raw config into fully defaulted, clamped values, so the client
 * and the tools never deal with optional fields or unsafe limits. Every field
 * is documented — this is the deployment contract (SPEC §4.2).
 */

import z from "@deepseek-ai/schemastery";

/** Retrieval modes the LightRAG `/query` endpoint accepts (SPEC §3). */
export const QUERY_MODES = [
  "local",
  "global",
  "hybrid",
  "naive",
  "mix",
  "bypass",
] as const;
export type QueryMode = (typeof QUERY_MODES)[number];

/** Raw user-facing configuration. */
export interface LightRagConfig {
  /** Master switch; when false no tool is registered at all. */
  readonly enabled?: boolean;
  /**
   * Origin of the LightRAG server, e.g. `http://lightrag:9621`. Must be a bare
   * http(s) origin: credentials, a path, a query or a fragment are rejected
   * when the configuration is loaded.
   */
  readonly endpoint?: string;
  /**
   * API key sent as `X-API-Key`. Falls back to the `LIGHTRAG_API_KEY`
   * environment variable, which is how the deployment kit passes it.
   */
  readonly apiKey?: string;
  /** Wall-clock budget per HTTP request, clamped to [1_000, 300_000] ms. */
  readonly timeoutMs?: number;
  readonly query?: {
    /** Default retrieval mode; an unknown value falls back to `mix`. */
    readonly mode?: string;
    /** Documents retrieved per query, clamped to [1, 200]. */
    readonly topK?: number;
    /** Byte cap for the returned answer, clamped to [1 KiB, 1 MiB]. */
    readonly maxAnswerBytes?: number;
  };
  readonly documents?: {
    /** Maximum documents listed in one call, clamped to [1, 1000]. */
    readonly maxListed?: number;
  };
  readonly writes?: {
    /** Registers `dsh_lightrag_insert`, `dsh_lightrag_scan` and `dsh_lightrag_delete`. */
    readonly enabled?: boolean;
    /** Byte cap for one inserted text, clamped to [1 KiB, 1 MiB]. */
    readonly maxTextBytes?: number;
  };
}

/** Fully defaulted, clamped configuration used by the client and the tools. */
export interface ResolvedLightRagConfig {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly queryMode: QueryMode;
  readonly queryTopK: number;
  readonly queryMaxAnswerBytes: number;
  readonly documentsMaxListed: number;
  readonly writesEnabled: boolean;
  readonly writesMaxTextBytes: number;
}

export const LIGHTRAG_DEFAULTS: ResolvedLightRagConfig = {
  enabled: true,
  endpoint: "http://127.0.0.1:9621",
  apiKey: "",
  timeoutMs: 60_000,
  queryMode: "mix",
  queryTopK: 20,
  queryMaxAnswerBytes: 200_000,
  documentsMaxListed: 200,
  writesEnabled: false,
  writesMaxTextBytes: 200_000,
};

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Validate the endpoint as a bare origin. A path, credentials, a query or a
 * fragment is a configuration error the operator sees at load time, not a
 * request that fails later with a puzzling 404 — the client appends the API
 * path itself, and an endpoint carrying one would silently double it.
 */
export function resolveLightRagEndpoint(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return LIGHTRAG_DEFAULTS.endpoint;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new TypeError(
      `dsh-lightrag: endpoint must be an absolute http(s) URL, got ${JSON.stringify(text)}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(
      `dsh-lightrag: endpoint must use http or https, got ${JSON.stringify(url.protocol)}`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new TypeError(
      "dsh-lightrag: endpoint must not carry credentials; put the key in apiKey",
    );
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new TypeError(
      `dsh-lightrag: endpoint must be a bare origin without a path, query or fragment, got ${JSON.stringify(text)}`,
    );
  }
  return url.origin;
}

/** Retrieval mode by name; an unknown or missing value is the default. */
export function resolveQueryMode(raw: unknown): QueryMode {
  return QUERY_MODES.includes(raw as QueryMode)
    ? (raw as QueryMode)
    : LIGHTRAG_DEFAULTS.queryMode;
}

export const LightRagConfigSchema: z<LightRagConfig> = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .description("Register the LightRAG knowledge-base tools."),
    endpoint: z
      .string()
      .default(LIGHTRAG_DEFAULTS.endpoint)
      .description(
        "Origin of the LightRAG server, e.g. http://lightrag:9621 (no path, credentials or query).",
      ),
    apiKey: z
      .string()
      .default("")
      .description(
        "API key sent as X-API-Key; empty falls back to LIGHTRAG_API_KEY.",
      ),
    timeoutMs: z
      .number()
      .default(LIGHTRAG_DEFAULTS.timeoutMs)
      .description(
        "Wall-clock budget per HTTP request in milliseconds (1000-300000).",
      ),
    query: z
      .object({
        mode: z
          .string()
          .default(LIGHTRAG_DEFAULTS.queryMode)
          .description(
            "Default retrieval mode: local, global, hybrid, naive, mix or bypass.",
          ),
        topK: z
          .number()
          .default(LIGHTRAG_DEFAULTS.queryTopK)
          .description("Documents retrieved per query (1-200)."),
        maxAnswerBytes: z
          .number()
          .default(LIGHTRAG_DEFAULTS.queryMaxAnswerBytes)
          .description("Byte cap for the returned answer (1024-1048576)."),
      })
      .description("Limits for dsh_lightrag_query."),
    documents: z
      .object({
        maxListed: z
          .number()
          .default(LIGHTRAG_DEFAULTS.documentsMaxListed)
          .description("Maximum documents listed by one call (1-1000)."),
      })
      .description("Limits for dsh_lightrag_documents."),
    writes: z
      .object({
        enabled: z
          .boolean()
          .default(false)
          .description(
            "Register dsh_lightrag_insert, dsh_lightrag_scan and dsh_lightrag_delete.",
          ),
        maxTextBytes: z
          .number()
          .default(LIGHTRAG_DEFAULTS.writesMaxTextBytes)
          .description("Byte cap for one inserted text (1024-1048576)."),
      })
      .description("Write tools; off by default."),
  })
  .description("LightRAG knowledge-base tools.");

/** Normalize and clamp raw configuration into the resolved shape. */
export function resolveLightRagConfig(
  raw?: LightRagConfig | unknown,
  env: Record<string, string | undefined> = process.env,
): ResolvedLightRagConfig {
  const config = (raw ?? {}) as LightRagConfig;
  const configuredKey =
    typeof config.apiKey === "string" ? config.apiKey.trim() : "";
  const environmentKey = (env["LIGHTRAG_API_KEY"] ?? "").trim();
  return {
    enabled: config.enabled ?? LIGHTRAG_DEFAULTS.enabled,
    endpoint: resolveLightRagEndpoint(config.endpoint),
    apiKey: configuredKey === "" ? environmentKey : configuredKey,
    timeoutMs: clampInteger(
      config.timeoutMs,
      1_000,
      300_000,
      LIGHTRAG_DEFAULTS.timeoutMs,
    ),
    queryMode: resolveQueryMode(config.query?.mode),
    queryTopK: clampInteger(
      config.query?.topK,
      1,
      200,
      LIGHTRAG_DEFAULTS.queryTopK,
    ),
    queryMaxAnswerBytes: clampInteger(
      config.query?.maxAnswerBytes,
      1_024,
      1_048_576,
      LIGHTRAG_DEFAULTS.queryMaxAnswerBytes,
    ),
    documentsMaxListed: clampInteger(
      config.documents?.maxListed,
      1,
      1_000,
      LIGHTRAG_DEFAULTS.documentsMaxListed,
    ),
    writesEnabled: config.writes?.enabled ?? LIGHTRAG_DEFAULTS.writesEnabled,
    writesMaxTextBytes: clampInteger(
      config.writes?.maxTextBytes,
      1_024,
      1_048_576,
      LIGHTRAG_DEFAULTS.writesMaxTextBytes,
    ),
  };
}
