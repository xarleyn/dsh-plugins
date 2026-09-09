/**
 * Configuration surface of the dsh-cas-results plugin (SPEC §23).
 *
 * The Schemastery schema (`CasResultsConfigSchema`) is the user-facing
 * contract exposed through the Cordis `static Config`; `resolveCasResultsConfig`
 * normalizes raw config into fully defaulted, validated values so the rest of
 * the plugin never deals with optional fields.
 */

import z from "@deepseek-ai/schemastery";

import { CasError } from "./cas/errors.js";
import type { CompressionMode } from "./cas/compression.js";
import type { PreviewStyle } from "./transform/scan-value.js";

/** Raw user-facing configuration (SPEC §23). */
export interface CasResultsConfig {
  /** Master switch; when false every tool result passes through untouched. */
  readonly enabled?: boolean;
  /**
   * Absolute store root. Empty string resolves to
   * `<$DSH_HOME>/storages/dsh-cas-results` (SPEC §14).
   */
  readonly storeDir?: string;
  readonly thresholds?: {
    /** Generic text offload threshold in bytes. */
    readonly textBytes?: number;
    /** HTML offload threshold in bytes. */
    readonly htmlBytes?: number;
    /** Log-like output offload threshold in bytes. */
    readonly logBytes?: number;
  };
  readonly preview?: {
    /** Total character budget for preview bodies. */
    readonly maxChars?: number;
    readonly keepHeadLines?: number;
    readonly keepTailLines?: number;
    /** Case-insensitive substrings kept from the middle of logs. */
    readonly keepPatterns?: readonly string[];
  };
  readonly base64?: {
    readonly enabled?: boolean;
    /** Minimum candidate length in characters. */
    readonly minChars?: number;
    /** Require data-URI context or binary evidence for raw candidates. */
    readonly requireStrongDetection?: boolean;
  };
  readonly storage?: {
    /** `none`, `gzip`, or `auto` (SPEC §17). */
    readonly compression?: CompressionMode;
    /** Logical-bytes quota enforced by GC (SPEC §24). */
    readonly maxBytes?: number;
  };
  readonly retrieval?: {
    /** Default chunk size for `dsh_cas_retrieve` in bytes. */
    readonly defaultBytes?: number;
    /** Hard upper bound for one retrieval chunk in bytes. */
    readonly maxBytes?: number;
  };
  readonly gc?: {
    readonly enabled?: boolean;
    /** Background collection interval in milliseconds. */
    readonly intervalMs?: number;
    /** Objects untouched for longer than this become eligible (ms). */
    readonly ttlMs?: number;
    /** Routine GC never deletes objects younger than this (ms). */
    readonly minAgeMs?: number;
  };
  /** Also preview oversized text inside failed tool results. Default: false. */
  readonly includeErrors?: boolean;
  /** Tools whose results are never transformed. */
  readonly excludeTools?: readonly string[];
  /** Per-tool policy overrides keyed by exact tool name. */
  readonly tools?: Readonly<Record<string, ToolOverrideConfig>>;
  /** Register the model-facing `dsh_cas_gc` tool. Default: false (SPEC §20). */
  readonly exposeGcTool?: boolean;
}

export interface ToolOverrideConfig {
  /** Offload threshold applied to textual fields of this tool. */
  readonly thresholdBytes?: number;
  /** Forced preview style; `auto` classifies per string. */
  readonly preview?: PreviewStyle;
  /** Enable/disable base64 offloading for this tool. */
  readonly base64?: boolean;
  /** Skip transformation for this tool entirely. */
  readonly disabled?: boolean;
}

/** Fully resolved configuration consumed by the runtime. */
export interface ResolvedCasResultsConfig {
  readonly enabled: boolean;
  readonly storeDir: string | null;
  readonly thresholds: { textBytes: number; htmlBytes: number; logBytes: number };
  readonly preview: {
    maxChars: number;
    keepHeadLines: number;
    keepTailLines: number;
    keepPatterns: readonly string[];
  };
  readonly base64: { enabled: boolean; minChars: number; requireStrongDetection: boolean };
  readonly storage: { compression: CompressionMode; maxBytes: number };
  readonly retrieval: { defaultBytes: number; maxBytes: number };
  readonly gc: { enabled: boolean; intervalMs: number; ttlMs: number; minAgeMs: number };
  readonly includeErrors: boolean;
  readonly excludeTools: readonly string[];
  readonly tools: Readonly<Record<string, ToolOverrideConfig>>;
  readonly exposeGcTool: boolean;
}

export const CAS_RESULTS_DEFAULTS = {
  enabled: true,
  textBytes: 16_384,
  htmlBytes: 8_192,
  logBytes: 16_384,
  maxChars: 4_096,
  keepHeadLines: 20,
  keepTailLines: 30,
  keepPatterns: ["error", "warn", "fail", "fatal", "exception", "assert", "panic", "denied", "timeout"],
  base64Enabled: true,
  base64MinChars: 8_192,
  base64RequireStrongDetection: true,
  compression: "auto",
  storageMaxBytes: 10 * 1024 * 1024 * 1024,
  retrievalDefaultBytes: 32_768,
  retrievalMaxBytes: 262_144,
  gcEnabled: true,
  gcIntervalMs: 3_600_000,
  gcTtlMs: 30 * 24 * 3_600_000,
  gcMinAgeMs: 24 * 3_600_000,
  includeErrors: false,
  // Editing tools stay excluded by default so read → edit workflows never
  // see replaced source snapshots (SPEC §22).
  excludeTools: ["write", "edit", "str_replace_editor"],
  exposeGcTool: false,
} as const;

const nullableNumber = z.union([z.number(), z.const(null)]);
const nullableBoolean = z.union([z.boolean(), z.const(null)]);
const nullablePreviewStyle = z.union([z.const("auto"), z.const("text"), z.const("log"), z.const("html"), z.const(null)]);

export const CasResultsConfigSchema = z.object({
  enabled: z.boolean().default(CAS_RESULTS_DEFAULTS.enabled),
  storeDir: z.string().default(""),
  thresholds: z
    .object({
      textBytes: z.number().default(CAS_RESULTS_DEFAULTS.textBytes),
      htmlBytes: z.number().default(CAS_RESULTS_DEFAULTS.htmlBytes),
      logBytes: z.number().default(CAS_RESULTS_DEFAULTS.logBytes),
    })
    .default({
      textBytes: CAS_RESULTS_DEFAULTS.textBytes,
      htmlBytes: CAS_RESULTS_DEFAULTS.htmlBytes,
      logBytes: CAS_RESULTS_DEFAULTS.logBytes,
    }),
  preview: z
    .object({
      maxChars: z.number().default(CAS_RESULTS_DEFAULTS.maxChars),
      keepHeadLines: z.number().default(CAS_RESULTS_DEFAULTS.keepHeadLines),
      keepTailLines: z.number().default(CAS_RESULTS_DEFAULTS.keepTailLines),
      keepPatterns: z.array(z.string()).default([...CAS_RESULTS_DEFAULTS.keepPatterns]),
    })
    .default({
      maxChars: CAS_RESULTS_DEFAULTS.maxChars,
      keepHeadLines: CAS_RESULTS_DEFAULTS.keepHeadLines,
      keepTailLines: CAS_RESULTS_DEFAULTS.keepTailLines,
      keepPatterns: [...CAS_RESULTS_DEFAULTS.keepPatterns],
    }),
  base64: z
    .object({
      enabled: z.boolean().default(CAS_RESULTS_DEFAULTS.base64Enabled),
      minChars: z.number().default(CAS_RESULTS_DEFAULTS.base64MinChars),
      requireStrongDetection: z.boolean().default(CAS_RESULTS_DEFAULTS.base64RequireStrongDetection),
    })
    .default({
      enabled: CAS_RESULTS_DEFAULTS.base64Enabled,
      minChars: CAS_RESULTS_DEFAULTS.base64MinChars,
      requireStrongDetection: CAS_RESULTS_DEFAULTS.base64RequireStrongDetection,
    }),
  storage: z
    .object({
      compression: z.union([z.const("none"), z.const("gzip"), z.const("auto")]).default(CAS_RESULTS_DEFAULTS.compression),
      maxBytes: z.number().default(CAS_RESULTS_DEFAULTS.storageMaxBytes),
    })
    .default({ compression: CAS_RESULTS_DEFAULTS.compression, maxBytes: CAS_RESULTS_DEFAULTS.storageMaxBytes }),
  retrieval: z
    .object({
      defaultBytes: z.number().default(CAS_RESULTS_DEFAULTS.retrievalDefaultBytes),
      maxBytes: z.number().default(CAS_RESULTS_DEFAULTS.retrievalMaxBytes),
    })
    .default({ defaultBytes: CAS_RESULTS_DEFAULTS.retrievalDefaultBytes, maxBytes: CAS_RESULTS_DEFAULTS.retrievalMaxBytes }),
  gc: z
    .object({
      enabled: z.boolean().default(CAS_RESULTS_DEFAULTS.gcEnabled),
      intervalMs: z.number().default(CAS_RESULTS_DEFAULTS.gcIntervalMs),
      ttlMs: z.number().default(CAS_RESULTS_DEFAULTS.gcTtlMs),
      minAgeMs: z.number().default(CAS_RESULTS_DEFAULTS.gcMinAgeMs),
    })
    .default({
      enabled: CAS_RESULTS_DEFAULTS.gcEnabled,
      intervalMs: CAS_RESULTS_DEFAULTS.gcIntervalMs,
      ttlMs: CAS_RESULTS_DEFAULTS.gcTtlMs,
      minAgeMs: CAS_RESULTS_DEFAULTS.gcMinAgeMs,
    }),
  includeErrors: z.boolean().default(CAS_RESULTS_DEFAULTS.includeErrors),
  excludeTools: z.array(z.string()).default([...CAS_RESULTS_DEFAULTS.excludeTools]),
  tools: z
    .dict(
      z.object({
        thresholdBytes: nullableNumber.default(null),
        preview: nullablePreviewStyle.default(null),
        base64: nullableBoolean.default(null),
        disabled: nullableBoolean.default(null),
      }),
    )
    .default({}),
  exposeGcTool: z.boolean().default(CAS_RESULTS_DEFAULTS.exposeGcTool),
}) as unknown as z<CasResultsConfig>;

function requirePositive(name: string, value: number, minimum: number): number {
  if (!Number.isFinite(value) || value < minimum || (minimum >= 1 && !Number.isInteger(value))) {
    throw new CasError("CAS_INVALID_ARGUMENT", `config "${name}" must be an integer >= ${minimum}`);
  }
  return value;
}

function requireNonNegative(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new CasError("CAS_INVALID_ARGUMENT", `config "${name}" must be a non-negative number`);
  }
  return value;
}

/**
 * Resolve raw config into validated values. Structurally impossible config
 * throws `CasError` ("CAS_INVALID_ARGUMENT") so misconfiguration is loud at
 * load time, while runtime storage failures fail open later (SPEC §26).
 */
export function resolveCasResultsConfig(input: CasResultsConfig = {}): ResolvedCasResultsConfig {
  const thresholds = {
    textBytes: requirePositive("thresholds.textBytes", input.thresholds?.textBytes ?? CAS_RESULTS_DEFAULTS.textBytes, 1),
    htmlBytes: requirePositive("thresholds.htmlBytes", input.thresholds?.htmlBytes ?? CAS_RESULTS_DEFAULTS.htmlBytes, 1),
    logBytes: requirePositive("thresholds.logBytes", input.thresholds?.logBytes ?? CAS_RESULTS_DEFAULTS.logBytes, 1),
  };
  const preview = {
    maxChars: requirePositive("preview.maxChars", input.preview?.maxChars ?? CAS_RESULTS_DEFAULTS.maxChars, 256),
    keepHeadLines: requireNonNegative("preview.keepHeadLines", input.preview?.keepHeadLines ?? CAS_RESULTS_DEFAULTS.keepHeadLines),
    keepTailLines: requireNonNegative("preview.keepTailLines", input.preview?.keepTailLines ?? CAS_RESULTS_DEFAULTS.keepTailLines),
    keepPatterns: [...(input.preview?.keepPatterns ?? CAS_RESULTS_DEFAULTS.keepPatterns)],
  };
  const base64 = {
    enabled: input.base64?.enabled ?? CAS_RESULTS_DEFAULTS.base64Enabled,
    minChars: requirePositive("base64.minChars", input.base64?.minChars ?? CAS_RESULTS_DEFAULTS.base64MinChars, 8),
    requireStrongDetection: input.base64?.requireStrongDetection ?? CAS_RESULTS_DEFAULTS.base64RequireStrongDetection,
  };
  const compression = input.storage?.compression ?? CAS_RESULTS_DEFAULTS.compression;
  if (compression !== "none" && compression !== "gzip" && compression !== "auto") {
    throw new CasError("CAS_INVALID_ARGUMENT", `config "storage.compression" must be none, gzip, or auto (got ${String(compression)})`);
  }
  const storage = {
    compression,
    maxBytes: requirePositive("storage.maxBytes", input.storage?.maxBytes ?? CAS_RESULTS_DEFAULTS.storageMaxBytes, 1),
  };
  const retrievalDefaultBytes = requirePositive(
    "retrieval.defaultBytes",
    input.retrieval?.defaultBytes ?? CAS_RESULTS_DEFAULTS.retrievalDefaultBytes,
    256,
  );
  const retrievalMaxBytes = requirePositive("retrieval.maxBytes", input.retrieval?.maxBytes ?? CAS_RESULTS_DEFAULTS.retrievalMaxBytes, 256);
  if (retrievalMaxBytes < retrievalDefaultBytes) {
    throw new CasError("CAS_INVALID_ARGUMENT", "config \"retrieval.maxBytes\" must be >= \"retrieval.defaultBytes\"");
  }
  const gcIntervalMs = requirePositive("gc.intervalMs", input.gc?.intervalMs ?? CAS_RESULTS_DEFAULTS.gcIntervalMs, 1_000);
  const gc = {
    enabled: input.gc?.enabled ?? CAS_RESULTS_DEFAULTS.gcEnabled,
    intervalMs: gcIntervalMs,
    ttlMs: requireNonNegative("gc.ttlMs", input.gc?.ttlMs ?? CAS_RESULTS_DEFAULTS.gcTtlMs),
    minAgeMs: requireNonNegative("gc.minAgeMs", input.gc?.minAgeMs ?? CAS_RESULTS_DEFAULTS.gcMinAgeMs),
  };
  const storeDir = input.storeDir?.trim();
  return {
    enabled: input.enabled ?? CAS_RESULTS_DEFAULTS.enabled,
    storeDir: storeDir ? storeDir : null,
    thresholds,
    preview,
    base64,
    storage,
    retrieval: { defaultBytes: retrievalDefaultBytes, maxBytes: retrievalMaxBytes },
    gc,
    includeErrors: input.includeErrors ?? CAS_RESULTS_DEFAULTS.includeErrors,
    excludeTools: [...(input.excludeTools ?? CAS_RESULTS_DEFAULTS.excludeTools)],
    tools: input.tools ?? {},
    exposeGcTool: input.exposeGcTool ?? CAS_RESULTS_DEFAULTS.exposeGcTool,
  };
}
