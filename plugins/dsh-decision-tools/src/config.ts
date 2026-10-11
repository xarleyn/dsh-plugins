import z from "@deepseek-ai/schemastery";
import { DecisionError, id, type Kind } from "./types.js";

export interface BackendConfig {
  /** Stable backend selector exposed to tools. */
  readonly id: string;
  /** Operator-owned HTTP(S) System One endpoint, never a tool argument. */
  readonly baseUrl: string;
  /** Model name/alias sent to this backend. */
  readonly model?: string;
  /** Environment variable holding the bearer key; empty means no authentication. */
  readonly apiKeyEnv?: string;
  /** Supported kinds declared by the operator, not inferred from wire compatibility. */
  readonly kinds?: Kind[];
}
export interface DecisionToolsConfig {
  /** Master switch: disabled registers no tools. */
  readonly enabled?: boolean;
  /** Default named backend. */
  readonly defaultBackend?: string;
  /** Operator-configured backends. No implicit hosted fallback. */
  readonly backends?: BackendConfig[];
  /** Deadline in milliseconds, including queue wait and response reading. */
  readonly timeoutMs?: number;
  /** Shared maximum active requests across all tools. */
  readonly maxConcurrency?: number;
  /** Maximum waiting requests; excess calls fail immediately. */
  readonly maxQueue?: number;
  /** Maximum serialized state characters, without silently truncating input. */
  readonly maxStateChars?: number;
  /** Maximum estimated state tokens. */
  readonly maxStateTokens?: number;
  /** Maximum estimated tokens for the entire wire request. */
  readonly maxRequestTokens?: number;
  /** Maximum typed questions in a single request. */
  readonly maxQuestions?: number;
  /** Maximum choice options or score levels. */
  readonly maxLabels?: number;
  /** Maximum response bytes read from the backend. */
  readonly maxResponseBytes?: number;
  /** Lower noul decision threshold; values between thresholds abstain. */
  readonly noThreshold?: number;
  /** Upper noul decision threshold. */
  readonly yesThreshold?: number;
  /** Minimum backend confidence for confident choice/score results. */
  readonly confidenceFloor?: number;
}
export interface Config {
  readonly enabled: boolean;
  readonly defaultBackend: string;
  readonly backends: readonly Required<BackendConfig>[];
  readonly timeoutMs: number;
  readonly maxConcurrency: number;
  readonly maxQueue: number;
  readonly maxStateChars: number;
  readonly maxStateTokens: number;
  readonly maxRequestTokens: number;
  readonly maxQuestions: number;
  readonly maxLabels: number;
  readonly maxResponseBytes: number;
  readonly noThreshold: number;
  readonly yesThreshold: number;
  readonly confidenceFloor: number;
}
const DEFAULT_BACKENDS: Required<BackendConfig>[] = [
  {
    id: "local",
    baseUrl: "http://localhost:8000",
    model: "jev-latest",
    apiKeyEnv: "JEFF_API_KEY",
    kinds: ["noul", "choice", "score"],
  },
];
function integer(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max)
    throw new DecisionError(
      "INVALID_CONFIG",
      `integer setting must be in ${min}..${max}`,
    );
  return value;
}
function probability(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0 || result > 1)
    throw new DecisionError(
      "INVALID_CONFIG",
      "thresholds must be finite numbers in [0,1]",
    );
  return result;
}
export function resolveConfig(raw: DecisionToolsConfig = {}): Config {
  const backends = (raw.backends ?? DEFAULT_BACKENDS).map((b) => {
    const url = new URL(b.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new DecisionError(
        "INVALID_CONFIG",
        "backend URL must be HTTP(S), without userinfo, query or fragment",
      );
    const kinds = b.kinds ?? ["noul", "choice", "score"];
    if (
      kinds.length === 0 ||
      kinds.some((k) => !["noul", "choice", "score"].includes(k)) ||
      new Set(kinds).size !== kinds.length
    )
      throw new DecisionError(
        "INVALID_CONFIG",
        "backend question kinds must be unique and supported",
      );
    const model = b.model ?? "jev-latest";
    const apiKeyEnv = b.apiKeyEnv ?? "JEFF_API_KEY";
    if (
      !model.trim() ||
      model.length > 128 ||
      (apiKeyEnv !== "" && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(apiKeyEnv))
    )
      throw new DecisionError(
        "INVALID_CONFIG",
        "invalid model or credential variable name",
      );
    return {
      id: id(b.id),
      baseUrl: url.href.replace(/\/$/u, ""),
      model,
      apiKeyEnv,
      kinds,
    };
  });
  const defaultBackend = raw.defaultBackend ?? "local";
  if (
    !backends.length ||
    new Set(backends.map((b) => b.id)).size !== backends.length ||
    !backends.some((b) => b.id === defaultBackend)
  )
    throw new DecisionError(
      "INVALID_CONFIG",
      "backends must be unique and include defaultBackend",
    );
  const noThreshold = probability(raw.noThreshold, 0.3);
  const yesThreshold = probability(raw.yesThreshold, 0.7);
  if (noThreshold >= yesThreshold)
    throw new DecisionError(
      "INVALID_CONFIG",
      "noThreshold must be below yesThreshold",
    );
  const config: Config = {
    enabled: raw.enabled ?? true,
    defaultBackend,
    backends,
    timeoutMs: integer(raw.timeoutMs, 45000, 100, 120000),
    maxConcurrency: integer(raw.maxConcurrency, 1, 1, 8),
    maxQueue: integer(raw.maxQueue, 8, 0, 64),
    maxStateChars: integer(raw.maxStateChars, 9000, 100, 1000000),
    maxStateTokens: integer(raw.maxStateTokens, 2400, 100, 100000),
    maxRequestTokens: integer(raw.maxRequestTokens, 2600, 100, 200000),
    maxQuestions: integer(raw.maxQuestions, 8, 1, 128),
    maxLabels: integer(raw.maxLabels, 16, 2, 64),
    maxResponseBytes: integer(raw.maxResponseBytes, 262144, 1024, 1048576),
    noThreshold,
    yesThreshold,
    confidenceFloor: probability(raw.confidenceFloor, 0.5),
  };
  if (config.maxStateTokens >= config.maxRequestTokens)
    throw new DecisionError(
      "INVALID_CONFIG",
      "request budget must exceed state budget",
    );
  return config;
}
export const ConfigSchema: z<DecisionToolsConfig> = z.object({
  enabled: z.boolean().default(true).description("Register decision tools."),
  defaultBackend: z
    .string()
    .default("local")
    .description("Default named backend."),
  backends: z
    .array(
      z.object({
        id: z.string().required(),
        baseUrl: z.string().required(),
        model: z.string().default("jev-latest"),
        apiKeyEnv: z.string().default("JEFF_API_KEY"),
        kinds: z
          .array(z.union(["noul", "choice", "score"]))
          .default(["noul", "choice", "score"]),
      }),
    )
    .default(DEFAULT_BACKENDS),
  timeoutMs: z.number().default(45000),
  maxConcurrency: z.number().default(1),
  maxQueue: z.number().default(8),
  maxStateChars: z.number().default(9000),
  maxStateTokens: z.number().default(2400),
  maxRequestTokens: z.number().default(2600),
  maxQuestions: z.number().default(8),
  maxLabels: z.number().default(16),
  maxResponseBytes: z.number().default(262144),
  noThreshold: z.number().default(0.3),
  yesThreshold: z.number().default(0.7),
  confidenceFloor: z.number().default(0.5),
});
