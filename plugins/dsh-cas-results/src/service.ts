/**
 * Public `ctx.casResults` service.
 *
 * A Cordis `Service` that wires the filesystem CAS, the `tools/post-execute`
 * interception seam, the `dsh_cas_*` retrieval tools, and background garbage
 * collection. Other plugins can consume the same store through this service
 * (SPEC §35): storage policy is separated from preview policy by design.
 *
 * Members use TypeScript `private` (not `#private`) because the host exposes
 * the service through a Cordis accessor proxy — the same convention the
 * reference plugins follow.
 */

import { join, resolve } from "node:path";

import { Context, Service } from "@deepseek-ai/cordis";
import {
  createHostLoggerSink,
  getPluginLogger,
  resolveDshHome,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";

import { FilesystemCasStore } from "./cas/filesystem-store.js";
import { parseCasRef } from "./cas/hash.js";
import type {
  CasGcResult,
  CasMetadata,
  CasObject,
  CasPutInput,
  CasReadOptions,
  CasReadResult,
  CasSearchQuery,
  CasSearchResult,
  CasStore,
  CasStoreStats,
} from "./cas/types.js";
import { CasResultsConfigSchema, resolveCasResultsConfig, type CasResultsConfig, type ResolvedCasResultsConfig } from "./config.js";
import { createPostExecuteListener, type CasPostExecuteListener } from "./integration/post-execute.js";
import type { PluginLoggerLike } from "./logging.js";
import { CasCounters, deriveCasMetrics } from "./observability/counters.js";
import { createGcTool } from "./tools/gc.js";
import { createInfoTool } from "./tools/info.js";
import { createRetrieveTool } from "./tools/retrieve.js";
import { createSearchTool } from "./tools/search.js";
import { createStatsTool } from "./tools/stats.js";

/**
 * Store root resolution (SPEC §14): explicit config path wins, otherwise
 * `<$DSH_HOME>/storages/dsh-cas-results`.
 */
export function resolveStoreDir(config: ResolvedCasResultsConfig, env: NodeJS.ProcessEnv = process.env): string {
  if (config.storeDir !== null) return resolve(config.storeDir);
  return join(resolveDshHome(env), "storages", "dsh-cas-results");
}

/** Overridable internals for tests (temp store, silent logger, fake clock). */
export interface CasResultsServiceDeps {
  readonly store?: CasStore;
  readonly storeRoot?: string;
  readonly logger?: PluginLoggerLike;
  readonly counters?: CasCounters;
}

interface ToolRegistryLike {
  register(definition: unknown): () => void;
}

interface ToolHostContextLike {
  tools: ToolRegistryLike;
  on(event: "tools/post-execute", listener: CasPostExecuteListener): () => void;
}

/** Aggregated statistics served by `dsh_cas_stats` and the service surface. */
export interface CasResultsStats extends CasStoreStats {
  readonly runtime: {
    resultsScanned: number;
    stringsScanned: number;
    objectsStored: number;
    casHits: number;
    logicalBytesOffloaded: number;
    physicalBytesWritten: number;
    previewBytes: number;
    retrievalCalls: number;
    searchCalls: number;
    retrievalBytes: number;
    gcObjectsDeleted: number;
    gcBytesFreed: number;
    storageErrors: number;
  };
  readonly derived: {
    dedupRatio: number;
    contextReduction: number;
    storeCompressionRatio: number;
  };
}

export class CasResultsService extends Service {
  static Config = CasResultsConfigSchema;

  readonly config: ResolvedCasResultsConfig;
  readonly store: CasStore;
  readonly counters: CasCounters;
  private readonly logger: PluginLoggerLike & { close?(): Promise<void> };
  private gcTimer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(ctx: Context, config: CasResultsConfig = {}, deps: CasResultsServiceDeps = {}) {
    super(ctx, "casResults");
    this.config = resolveCasResultsConfig(config);
    this.logger =
      deps.logger ??
      (getPluginLogger({
        pluginId: "dsh-cas-results",
        consoleSink: createHostLoggerSink(ctx.logger),
      }) as PluginLogger & PluginLoggerLike);
    this.counters = deps.counters ?? new CasCounters();
    this.store =
      deps.store ??
      new FilesystemCasStore(deps.storeRoot ?? resolveStoreDir(this.config), {
        compression: this.config.storage.compression,
      });

    const disposers: (() => void)[] = [];
    ctx.inject(["tools"], (toolCtx: ToolHostContextLike) => {
      disposers.push(
        toolCtx.on(
          "tools/post-execute",
          createPostExecuteListener({
            store: this.store,
            counters: this.counters,
            readConfig: () => this.config,
            logger: this.logger,
          }),
        ),
      );
      const toolDeps = { store: this.store, counters: this.counters, readConfig: () => this.config };
      disposers.push(toolCtx.tools.register(createRetrieveTool(toolDeps)));
      disposers.push(toolCtx.tools.register(createSearchTool({ store: this.store, counters: this.counters })));
      disposers.push(toolCtx.tools.register(createInfoTool({ store: this.store })));
      disposers.push(toolCtx.tools.register(createStatsTool({ store: this.store, counters: this.counters })));
      if (this.config.exposeGcTool) {
        disposers.push(toolCtx.tools.register(createGcTool({ store: this.store, readConfig: () => this.config })));
      }
    });

    ctx.effect(() => () => void this.dispose(), "dsh-cas-results.lifecycle");
    this.logger.info("cas.plugin_ready", {
      storeRoot: deps.storeRoot ?? resolveStoreDir(this.config),
      compression: this.config.storage.compression,
      enabled: this.config.enabled,
    });
    // Best-effort startup collection: expired objects and orphan temp files.
    void this.gc().catch((error: unknown) => {
      this.logger.warn("cas.startup_gc_failed", { error: error instanceof Error ? error.message : String(error) });
    });
    if (this.config.gc.enabled) {
      this.gcTimer = setInterval(() => {
        void this.gc().catch((error: unknown) => {
          this.logger.warn("cas.background_gc_failed", { error: error instanceof Error ? error.message : String(error) });
        });
      }, this.config.gc.intervalMs);
      this.gcTimer.unref?.();
    }
  }

  /** Store a payload directly; shared entry point for other plugins (SPEC §35). */
  async put(input: CasPutInput): Promise<CasObject> {
    const object = await this.store.put(input);
    if (object.reused) this.counters.increment("casHits");
    else this.counters.increment("objectsStored");
    return object;
  }

  /** Read a stored object by reference with verified, bounded access. */
  async read(ref: string, options: CasReadOptions = {}): Promise<CasReadResult> {
    return this.store.read(parseCasRef(ref), options);
  }

  async search(ref: string, query: CasSearchQuery): Promise<CasSearchResult> {
    return this.store.search(parseCasRef(ref), query);
  }

  async stat(ref: string): Promise<CasMetadata | null> {
    return this.store.stat(parseCasRef(ref));
  }

  /** Run one collection pass with the configured TTL and quota. */
  async gc(): Promise<CasGcResult> {
    const outcome = await this.store.gc({
      ttlMs: this.config.gc.ttlMs,
      minAgeMs: this.config.gc.minAgeMs,
      maxBytes: this.config.storage.maxBytes,
    });
    if (outcome.deletedObjects > 0) {
      this.counters.add({ gcObjectsDeleted: outcome.deletedObjects, gcBytesFreed: outcome.freedBytes });
      this.logger.info("cas.gc_completed", {
        deleted: outcome.deletedObjects,
        freedBytes: outcome.freedBytes,
        scanned: outcome.scannedObjects,
      });
    }
    return outcome;
  }

  /** Disk aggregates merged with runtime counters and derived ratios (SPEC §28). */
  async stats(): Promise<CasResultsStats> {
    const disk = await this.store.stats();
    const runtime = this.counters.snapshot();
    return {
      ...disk,
      runtime,
      derived: deriveCasMetrics(runtime, disk),
    };
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.gcTimer !== undefined) {
      clearInterval(this.gcTimer);
      this.gcTimer = undefined;
    }
    void this.logger.close?.();
  }
}
