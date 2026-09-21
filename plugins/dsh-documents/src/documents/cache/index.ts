/**
 * The conversion cache, as the orchestrator sees it.
 *
 * The orchestrator asks two questions — "is there a verified result for this
 * request?" and "remember what this run produced" — and this module answers
 * them. It owns everything in between: probe the backends that would run, build
 * the key, read the entry, copy the bytes, and record the hit. A cache failure
 * degrades to a miss; it never fails a conversion, which is why every write
 * here swallows (and reports) its error instead of propagating it.
 */

import { stat } from "node:fs/promises";

import type { ResolvedDocumentsConfig } from "../config.js";
import type { ArtifactStore } from "../artifacts/store.js";
import type { DocumentLogger } from "../orchestrator/runtime-deps.js";
import type {
  DocumentFormat,
  DocumentWarning,
  ExtractionMode,
  OcrMode,
} from "../types.js";
import {
  CACHE_ENTRY_VERSION,
  conversionCacheKey,
  extractionCacheKey,
  pipelineFingerprint,
  probeProviderVersion,
  type DocumentCacheEntry,
  type DocumentCacheOutput,
  type DocumentCacheProvider,
} from "./key.js";
import { materializeCacheHit, type MaterializedHit } from "./materialize.js";
import { CacheStore } from "./store.js";

export {
  CACHE_DIRECTORY,
  CACHE_ENTRY_VERSION,
  cacheKey,
  canonicalJson,
  conversionCacheKey,
  extractionCacheKey,
  pipelineFingerprint,
  probeProviderVersion,
  type CacheKeyInput,
  type DocumentCacheEntry,
  type DocumentCacheOperation,
  type DocumentCacheOutput,
  type DocumentCacheProvider,
} from "./key.js";
export {
  discardBundle,
  fingerprintOutput,
  materializeCacheHit,
  type MaterializedHit,
  type MaterializedOutput,
} from "./materialize.js";
export {
  CacheStore,
  type CachePruneReport,
  type CacheStoreOptions,
} from "./store.js";

/** Provider roles, so a key names what each backend was doing. */
export type CacheProviderRole = "extract" | "convert";

/** A provider the run would call; the cache reads its version lazily. */
export interface CacheProviderRef {
  readonly role: CacheProviderRole;
  readonly name: string;
  readonly instance: unknown;
}

export interface ConversionCacheOptions {
  readonly config: ResolvedDocumentsConfig;
  readonly store: ArtifactStore;
  readonly logger: DocumentLogger;
  readonly now: () => Date;
}

/** Everything a lookup needs to identify the extraction it would replace. */
export interface ExtractionRequest {
  readonly sourceFormat: DocumentFormat;
  readonly targetFormat: DocumentFormat;
  readonly inputSha256: string;
  readonly inputFilename: string;
  readonly mode: ExtractionMode;
  readonly ocr: OcrMode;
  readonly ocrLanguages: readonly string[];
  readonly extractImages: boolean;
  readonly extractTables: boolean;
  readonly preservePageMarkers: boolean;
  readonly providers: readonly CacheProviderRef[];
}

/** Everything a lookup needs to identify the conversion it would replace. */
export interface ConversionRequest {
  readonly sourceFormat: DocumentFormat;
  readonly targetFormat: DocumentFormat;
  readonly inputSha256: string;
  readonly inputFilename: string;
  readonly providers: readonly CacheProviderRef[];
}

/** One produced file, as the cache records it. */
export interface StoreOutputSpec {
  readonly role: CacheProviderRole;
  readonly artifactId: string;
  /** Bare file name inside the bundle. */
  readonly outputName: string;
  readonly format: DocumentFormat;
  /** Absolute path of the file on disk. */
  readonly path: string;
  readonly mediaType: string;
  readonly sha256: string;
}

/** A request whose key has been resolved, ready to look up and to record. */
export interface CacheHandle {
  readonly key: string;
  /** Materialize a verified hit into `artifactId`, or `undefined` to run. */
  lookup(
    artifactId: string,
    outputName: (output: DocumentCacheOutput) => string,
  ): Promise<MaterializedHit | undefined>;
  /** Record a successful run under this key. */
  remember(options: {
    readonly outputs: readonly StoreOutputSpec[];
    readonly warnings: readonly DocumentWarning[];
    readonly backends: Readonly<Record<string, { provider: string }>>;
    readonly extras?: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

export class ConversionCache {
  private readonly config: ResolvedDocumentsConfig;
  private readonly store: ArtifactStore;
  private readonly logger: DocumentLogger;
  private readonly now: () => Date;
  private readonly cache: CacheStore | undefined;
  private readonly pipeline: string;

  constructor(options: ConversionCacheOptions) {
    this.config = options.config;
    this.store = options.store;
    this.logger = options.logger;
    this.now = options.now;
    this.pipeline = pipelineFingerprint(options.config);
    this.cache = options.config.cache.enabled
      ? new CacheStore({
          root: options.store.root,
          maxAgeDays: options.config.cache.maxAgeDays,
          maxEntries: options.config.cache.maxEntries,
          maxBytes: options.config.cache.maxBytes,
        })
      : undefined;
  }

  /** Whether caching is on for this deployment. */
  get enabled(): boolean {
    return this.cache !== undefined;
  }

  /**
   * Resolve the key of an extraction request. The handle is inert when caching
   * is off, so callers never branch on whether the cache exists.
   */
  async beginExtraction(request: ExtractionRequest): Promise<CacheHandle> {
    return await this.handle(
      await extractionCacheKey({
        config: this.config,
        scopeFormat: request.sourceFormat,
        targetFormat: request.targetFormat,
        inputSha256: request.inputSha256,
        inputFilename: request.inputFilename,
        mode: request.mode,
        ocr: request.ocr,
        ocrLanguages: request.ocrLanguages,
        extractImages: request.extractImages,
        extractTables: request.extractTables,
        preservePageMarkers: request.preservePageMarkers,
        providers: await this.providerIdentities(request.providers),
      }),
    );
  }

  /** Resolve the key of a direct conversion request. */
  async beginConversion(request: ConversionRequest): Promise<CacheHandle> {
    return await this.handle(
      await conversionCacheKey({
        config: this.config,
        sourceFormat: request.sourceFormat,
        targetFormat: request.targetFormat,
        inputSha256: request.inputSha256,
        inputFilename: request.inputFilename,
        providers: await this.providerIdentities(request.providers),
      }),
    );
  }

  private async handle(key: string): Promise<CacheHandle> {
    return {
      key,
      lookup: async (artifactId, outputName) =>
        await this.hit(key, artifactId, outputName),
      remember: async (options) => await this.remember(key, options),
    };
  }

  /**
   * Record a run. Called only after the operation succeeded and the outputs are
   * on disk; a failed conversion must not leave an entry behind.
   */
  private async remember(
    key: string,
    options: {
      readonly outputs: readonly StoreOutputSpec[];
      readonly warnings: readonly DocumentWarning[];
      readonly backends: Readonly<Record<string, { provider: string }>>;
      readonly extras?: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    const cache = this.cache;
    if (cache === undefined || options.outputs.length === 0) return;
    try {
      const stored: DocumentCacheOutput[] = [];
      for (const output of options.outputs) {
        const details = await stat(output.path);
        stored.push({
          artifactId: output.artifactId,
          outputName: output.outputName,
          format: output.format,
          mediaType: output.mediaType,
          size: details.size,
          sha256: output.sha256,
        });
      }
      const existing = await cache.get(key);
      const now = this.now().toISOString();
      const entry: DocumentCacheEntry = {
        version: CACHE_ENTRY_VERSION,
        key,
        operation: "document_convert",
        createdAt: existing?.createdAt ?? now,
        accessedAt: now,
        hitCount: existing?.hitCount ?? 0,
        bytes: stored.reduce((total, output) => total + output.size, 0),
        outputs: stored,
        backends: uniqueProviders(
          options.outputs.map((output) => ({
            role: output.role,
            provider: options.backends[output.role]?.provider ?? output.role,
          })),
        ),
        warnings: options.warnings.map((warning) => ({
          code: warning.code,
          message: warning.message,
          ...(warning.backend === undefined
            ? {}
            : { backend: warning.backend }),
          ...(warning.details === undefined
            ? {}
            : { details: warning.details }),
        })),
        ...(options.extras === undefined ? {} : { extras: options.extras }),
      };
      await cache.put(entry, this.now());
    } catch (error) {
      this.logger.warn("documents.cache.write.failed", {
        key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async hit(
    key: string,
    artifactId: string,
    outputName: (output: DocumentCacheOutput) => string,
  ): Promise<MaterializedHit | undefined> {
    const cache = this.cache;
    if (cache === undefined) return undefined;
    const entry = await cache.get(key);
    if (entry === undefined) return undefined;
    const materialized = await materializeCacheHit({
      store: this.store,
      artifactId,
      entry,
      outputName,
    });
    if (materialized === undefined) {
      this.logger.warn("documents.cache.stale", { key });
      return undefined;
    }
    await cache.refresh(entry, this.now()).catch(() => undefined);
    this.logger.info("documents.cache.hit", {
      key,
      artifactId,
      sourceArtifactId: entry.outputs[0]?.artifactId,
      ageMs: this.now().getTime() - Date.parse(entry.createdAt),
    });
    return materialized;
  }

  /** Stable identity of a set of providers; order is part of it. */
  private async providerIdentities(
    providers: readonly CacheProviderRef[],
  ): Promise<DocumentCacheProvider[]> {
    const identities: DocumentCacheProvider[] = [];
    for (const provider of providers) {
      const version = await probeProviderVersion(
        provider.instance as { name: string; version?: unknown },
      );
      identities.push({
        role: provider.role,
        provider: provider.name,
        ...(version === undefined ? {} : { version }),
      });
    }
    return identities;
  }
}

function uniqueProviders(
  providers: readonly DocumentCacheProvider[],
): DocumentCacheProvider[] {
  const seen = new Map<string, DocumentCacheProvider>();
  for (const provider of providers) {
    seen.set(`${provider.role}:${provider.provider}`, provider);
  }
  return [...seen.values()];
}
