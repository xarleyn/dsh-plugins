/**
 * Cache identity for document conversions.
 *
 * A cached conversion is trusted only when everything that could change its
 * bytes is part of the key: the input file's own content, the request options,
 * the shape of the pipeline and the identity of the backends that would run.
 * Anything that cannot change the result — how long the call waited, how many
 * workers ran in parallel — stays out, or the cache would never hit.
 *
 * Keys are hashes of a canonical JSON projection, so the entry file carries no
 * configuration text and two deployments with the same settings share entries
 * without sharing secrets. The volume snapshot has a stable serialization:
 * object keys are sorted, `undefined` is dropped and `null` is preserved.
 */

import type { ResolvedDocumentsConfig } from "../config.js";
import { sha256Hex } from "../artifacts/store.js";
import type { DocumentFormat, ExtractionMode, OcrMode } from "../types.js";

/** Operations whose provider work is cached. */
export type DocumentCacheOperation = "document_convert";

/** One output file of a cached operation. */
export interface DocumentCacheOutput {
  /** Artifact bundle the file lives in. */
  readonly artifactId: string;
  /** File name inside that bundle; always a bare name, never a path. */
  readonly outputName: string;
  readonly format: DocumentFormat;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
}

/**
 * What one backend lookup produced. `provider` is the name the provider
 * reports; `version` is read from the provider when it exposes one, and is
 * omitted (rather than guessed) when it does not.
 */
export interface DocumentCacheProvider {
  readonly role: string;
  readonly provider: string;
  readonly version?: string;
}

/** The cached result of one conversion, as stored under `.cache/`. */
export interface DocumentCacheEntry {
  readonly version: typeof CACHE_ENTRY_VERSION;
  readonly key: string;
  readonly operation: DocumentCacheOperation;
  readonly createdAt: string;
  readonly accessedAt: string;
  readonly hitCount: number;
  /** Bytes of all cached files, for the size budget. */
  readonly bytes: number;
  readonly outputs: readonly DocumentCacheOutput[];
  readonly backends: readonly DocumentCacheProvider[];
  readonly warnings: readonly {
    readonly code: string;
    readonly message: string;
    readonly backend?: string;
    readonly details?: Readonly<Record<string, unknown>>;
  }[];
  /**
   * Facts the result carries beside its files — pages, extracted assets — so a
   * hit can report what a run would have reported. Only JSON-safe values.
   */
  readonly extras?: Readonly<Record<string, unknown>>;
}

/** Bump when the meaning of a stored entry changes; old entries are ignored. */
export const CACHE_ENTRY_VERSION = 1 as const;

/** Directory, inside the artifact root, the entries live in. */
export const CACHE_DIRECTORY = ".cache";

/**
 * The settings that decide what a backend is asked to do. Operational knobs
 * (timeouts, concurrency) are deliberately absent: changing them does not
 * change bytes, and including them would invalidate every entry on a tuning
 * day. `maxPages`/`maxExtractedImages` are here because they do cut output.
 */
export function pipelineFingerprint(config: ResolvedDocumentsConfig): string {
  return sha256Hex(canonicalJson(configFingerprint(config)));
}

function configFingerprint(
  config: ResolvedDocumentsConfig,
): Readonly<Record<string, unknown>> {
  return {
    extraction: {
      defaultMode: config.extraction.defaultMode,
      ocr: config.extraction.ocr,
      ocrLanguages: config.extraction.ocrLanguages,
      extractImages: config.extraction.extractImages,
      extractTables: config.extraction.extractTables,
      preservePageMarkers: config.extraction.preservePageMarkers,
      allowFallback: config.extraction.allowFallback,
    },
    docling: {
      enabled: config.docling.enabled,
      baseUrl: config.docling.baseUrl,
    },
    markitdown: { enabled: config.markitdown.enabled },
    pandoc: { executable: config.pandoc.executable },
    libreoffice: { executable: config.libreoffice.executable },
    typst: { enabled: config.typst.enabled },
    create: { allowFormats: config.create.allowFormats },
    limits: {
      maxInputBytes: config.limits.maxInputBytes,
      maxPages: config.limits.maxPages,
      maxExtractedImages: config.limits.maxExtractedImages,
      maxExtractedMarkdownBytes: config.limits.maxExtractedMarkdownBytes,
    },
  };
}

export interface CacheKeyInput {
  readonly operation: DocumentCacheOperation;
  readonly sourceFormat: DocumentFormat;
  readonly targetFormat: DocumentFormat;
  /** SHA-256 of the input bytes; the content that would be converted. */
  readonly inputSha256: string;
  /**
   * Bare input file name. The same bytes under two names convert to the same
   * bytes, but an entry stored for `report.docx` is not silently reused for
   * someone else's identically named working copy — the name is part of what
   * the caller asked for, and keeping it makes the hit explainable.
   */
  readonly inputFilename: string;
  readonly options: Readonly<Record<string, unknown>>;
  /** Fingerprint of the pipeline settings that shape the request. */
  readonly pipeline: string;
  readonly providers: readonly DocumentCacheProvider[];
}

/** Stable hex key of one conversion request. */
export function cacheKey(input: CacheKeyInput): string {
  return sha256Hex(
    canonicalJson({
      operation: input.operation,
      source: input.sourceFormat,
      target: input.targetFormat,
      input: {
        sha256: input.inputSha256,
        filename: input.inputFilename,
      },
      options: input.options,
      pipeline: input.pipeline,
      providers: input.providers.map((provider) => ({
        role: provider.role,
        provider: provider.provider,
        version: provider.version ?? null,
      })),
    }),
  );
}

export interface ExtractCacheKeyInput {
  readonly config: ResolvedDocumentsConfig;
  readonly scopeFormat: DocumentFormat;
  readonly targetFormat: DocumentFormat;
  readonly inputSha256: string;
  readonly inputFilename: string;
  readonly mode: ExtractionMode;
  readonly ocr: OcrMode;
  readonly ocrLanguages: readonly string[];
  readonly extractImages: boolean;
  readonly extractTables: boolean;
  readonly preservePageMarkers: boolean;
  readonly providers: readonly DocumentCacheProvider[];
}

/** Identity of an extractor run (`docx`/`pdf` → `md`). */
export function extractionCacheKey(input: ExtractCacheKeyInput): string {
  return cacheKey({
    operation: "document_convert",
    sourceFormat: input.scopeFormat,
    targetFormat: input.targetFormat,
    inputSha256: input.inputSha256,
    inputFilename: input.inputFilename,
    options: {
      mode: input.mode,
      ocr: input.ocr,
      ocrLanguages: input.ocrLanguages,
      extractImages: input.extractImages,
      extractTables: input.extractTables,
      preservePageMarkers: input.preservePageMarkers,
    },
    pipeline: pipelineFingerprint(input.config),
    providers: input.providers,
  });
}

export interface ConvertCacheKeyInput {
  readonly config: ResolvedDocumentsConfig;
  readonly sourceFormat: DocumentFormat;
  readonly targetFormat: DocumentFormat;
  readonly inputSha256: string;
  readonly inputFilename: string;
  readonly providers: readonly DocumentCacheProvider[];
}

/** Identity of a direct conversion (`docx` → `pdf`). */
export function conversionCacheKey(input: ConvertCacheKeyInput): string {
  return cacheKey({
    operation: "document_convert",
    sourceFormat: input.sourceFormat,
    targetFormat: input.targetFormat,
    inputSha256: input.inputSha256,
    inputFilename: input.inputFilename,
    options: {},
    pipeline: pipelineFingerprint(input.config),
    providers: input.providers,
  });
}

/**
 * JSON with sorted object keys. Used only for hashing, never written to disk,
 * so a single canonical form per value is what matters, not readability.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(
    entries.map(([key, entry]) => [key, sortValue(entry)]),
  );
}

/**
 * Read the version a provider reports about itself. Providers are free to omit
 * it (the interface has no `version` member), and a probe that hangs or fails
 * must not turn a conversion into a failure — an unversioned backend is
 * recorded as unversioned, which is still a correct cache key.
 */
export async function probeProviderVersion(provider: {
  readonly name: string;
  readonly version?: unknown;
}): Promise<string | undefined> {
  const version = provider.version;
  if (typeof version !== "function") return undefined;
  try {
    const probed = await (version as () => Promise<unknown>).call(provider);
    return typeof probed === "string" && probed.trim() !== ""
      ? probed.trim()
      : undefined;
  } catch {
    return undefined;
  }
}
