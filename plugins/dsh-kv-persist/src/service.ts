/**
 * Public `ctx.kvPersist` service (SPEC §11, §47).
 *
 * A Cordis `Service` that wires the coordinator, backend, repository, and
 * lifecycle listeners together. Future UI/CLI plugins can depend on this
 * surface without knowing anything about llama.cpp.
 *
 * Members use TypeScript `private` (not `#private`): the host exposes the
 * service through a Cordis accessor proxy, and `#private` branding breaks
 * when methods are invoked with a proxy receiver — the same convention the
 * reference plugins follow.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, Service } from "@deepseek-ai/cordis";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { KvPersistConfigSchema, resolveKvPersistConfig, isManagedProvider } from "./config.js";
import type { KvPersistConfig, ResolvedKvPersistConfig } from "./config.js";
import type { SnapshotInvalidationReason } from "./errors.js";
import { LlamaCppBackend } from "./backends/llama-cpp/backend.js";
import type { KvPersistenceBackend } from "./backends/types.js";
import { SingleSlotCoordinator } from "./coordinator/coordinator.js";
import type { RestoreOutcome, SnapshotResult } from "./coordinator/state-machine.js";
import { createKvPersistLogger } from "./observability/diagnostics.js";
import type { KvPersistLogger } from "./observability/diagnostics.js";
import { KvPersistMetrics } from "./observability/metrics.js";
import { SnapshotRepository } from "./snapshots/repository.js";

/**
 * Metadata root resolution (SPEC §39): explicit config path wins, otherwise
 * `<$DSH_HOME>/cache/dsh-kv-persist` (cwd fallback for dev/test).
 */
export function resolveMetadataDir(config: ResolvedKvPersistConfig): string {
  if (config.metadataPath !== null) return config.metadataPath;
  const dshHome = process.env.DSH_HOME?.trim() ?? "";
  return join(dshHome.length > 0 ? dshHome : process.cwd(), "cache", "dsh-kv-persist");
}

/** Overridable internals for tests (fake backend, temp repository, …). */
export interface KvPersistServiceDeps {
  readonly backend?: KvPersistenceBackend;
  readonly repository?: SnapshotRepository;
  readonly logger?: KvPersistLogger;
  readonly now?: () => number;
}

/** Status payload (SPEC §47). */
export interface KvPersistStatus {
  readonly enabled: boolean;
  readonly backend: {
    readonly kind: "llama.cpp";
    readonly state: string;
    readonly endpoint: string;
  };
  readonly mode: "single-slot";
  readonly slots: readonly {
    readonly id: number;
    readonly owner: string | null;
    readonly state: string;
  }[];
  readonly snapshots: {
    readonly known: number;
    readonly valid: number;
    readonly invalid: number;
  };
  readonly stats: {
    readonly restores: number;
    readonly restoreHits: number;
    readonly coldStarts: number;
    readonly saves: number;
  };
}

/** Per-session state view (SPEC §11 `getSessionState`). */
export interface SessionKvState {
  readonly sessionId: string;
  readonly lifecycle: string;
  readonly provider: string;
  readonly model: string;
  readonly dirtyRevision: number;
  readonly persistedRevision: number;
  readonly ownsSlot: boolean;
}

/** Doctor report (SPEC §34, §48-lite). */
export interface KvPersistDoctorReport {
  readonly result: "READY" | "BLOCKED";
  readonly checks: readonly {
    readonly name: string;
    readonly ok: boolean;
    readonly detail: string;
  }[];
}

/** Host logger facade used by the plugin. */
interface HostLoggerLike {
  info(message: string, ...values: unknown[]): unknown;
  warn(message: string, ...values: unknown[]): unknown;
  error(message: string, ...values: unknown[]): unknown;
  debug?(message: string, ...values: unknown[]): unknown;
}

/**
 * Register a host event whose name lives in the host's session-service
 * vocabulary rather than the plugin-visible `Events` interface. The cast
 * mirrors the structural lifecycle-registration pattern used across this
 * monorepo (guidelines §3.3; reference: dsh-doc-impact lifecycle wiring).
 */
function registerHostEvent(
  ctx: Context,
  event: string,
  listener: (...args: never[]) => unknown,
): void {
  (ctx.on as (name: string, listener: (...args: never[]) => unknown) => unknown)(event, listener);
}

export class KvPersistService extends Service {
  static Config = KvPersistConfigSchema;

  private readonly config: ResolvedKvPersistConfig;
  private readonly backend: KvPersistenceBackend;
  private readonly repository: SnapshotRepository;
  private readonly logger: KvPersistLogger;
  private readonly metrics = new KvPersistMetrics();
  private readonly coordinator: SingleSlotCoordinator;

  constructor(ctx: Context, config: KvPersistConfig = {}, deps: KvPersistServiceDeps = {}) {
    super(ctx, "kvPersist");
    const resolved = resolveKvPersistConfig(config);
    this.config = resolved;
    this.logger =
      deps.logger ??
      createKvPersistLogger(ctx.logger as HostLoggerLike, resolved.logLevel);
    this.repository =
      deps.repository ?? new SnapshotRepository(resolveMetadataDir(resolved));
    this.backend =
      deps.backend ??
      new LlamaCppBackend(
        {
          baseURL: resolved.baseURL,
          apiKey: resolved.apiKey,
          requestTimeoutMs: resolved.requestTimeoutMs,
        },
        resolved.slotId,
      );
    this.coordinator = new SingleSlotCoordinator({
      config: resolved,
      backend: this.backend,
      repository: this.repository,
      metrics: this.metrics,
      logger: this.logger,
      now: deps.now,
    });
    this.register(ctx);
  }

  /** Config access for diagnostics. */
  get resolvedConfig(): ResolvedKvPersistConfig {
    return this.config;
  }

  // ——— public API (SPEC §11) ————————————————————————————————————————————

  /** Diagnostics snapshot (SPEC §47). */
  async status(): Promise<KvPersistStatus> {
    const counts = await this.repository.counts().catch(() => ({ known: 0, valid: 0, invalid: 0 }));
    const counters = this.metrics.snapshot();
    const slot = this.coordinator.slot;
    return {
      enabled: this.config.enabled,
      backend: {
        kind: "llama.cpp",
        state: this.coordinator.circuitState,
        endpoint: this.config.baseURL,
      },
      mode: "single-slot",
      slots: [
        {
          id: slot.id,
          owner: slot.ownerSessionId,
          state: slot.state,
        },
      ],
      snapshots: counts,
      stats: {
        restores: counters.restores,
        restoreHits: counters.restoreHits,
        coldStarts: counters.coldPrefills,
        saves: counters.saves,
      },
    };
  }

  /** Runtime state of one session, when known. */
  getSessionState(sessionId: string): SessionKvState | undefined {
    const runtime = this.coordinator.getSessionState(sessionId);
    if (runtime === undefined) return undefined;
    return {
      sessionId,
      lifecycle: runtime.lifecycle,
      provider: runtime.route.provider,
      model: runtime.route.model,
      dirtyRevision: runtime.dirtyRevision,
      persistedRevision: runtime.persistedRevision,
      ownsSlot: this.coordinator.slot.ownerSessionId === sessionId,
    };
  }

  /** Force a checkpoint of the session (SPEC §11 `save`). */
  save(sessionId: string): Promise<SnapshotResult> {
    return this.coordinator.saveNow(sessionId);
  }

  /** Force a restore for the session (SPEC §11 `restore`). */
  restore(sessionId: string): Promise<RestoreOutcome> {
    return this.coordinator.restoreNow(sessionId);
  }

  /** Mark every snapshot of the session invalid, without deleting (§31). */
  invalidate(sessionId: string, reason?: SnapshotInvalidationReason): Promise<void> {
    return this.coordinator.invalidate(sessionId, reason ?? "EXPLICIT");
  }

  /** Remove all metadata of the session (binary cleanup is server-owned). */
  purge(sessionId: string): Promise<void> {
    return this.coordinator.purge(sessionId);
  }

  /** Checkpoint the dirty owned session now, if any (SPEC §11 `flush`). */
  flush(): Promise<void> {
    return this.coordinator.flushOwned("manual");
  }

  /** Managed-provider filter (SPEC §37): only explicit providers are coordinated. */
  handles(provider: string): boolean {
    return this.config.enabled && isManagedProvider(this.config, provider);
  }

  /** Backend + metadata probe (SPEC §34; CLI `doctor` basis, §48). */
  async doctor(): Promise<KvPersistDoctorReport> {
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    const probe = await this.coordinator.probeBackend();
    checks.push({
      name: "slots-api",
      ok: probe.healthy,
      detail: probe.healthy
        ? `reachable, slots: [${probe.slotIds.join(", ")}]`
        : (probe.error ?? "unreachable"),
    });
    checks.push({
      name: "configured-slot",
      ok: probe.slotIds.includes(this.config.slotId),
      detail: `slot ${this.config.slotId} required (mode: ${this.config.mode})`,
    });
    checks.push(await this.checkMetadataWritable());
    return {
      result: checks.every((check) => check.ok) ? "READY" : "BLOCKED",
      checks,
    };
  }

  // ——— lifecycle wiring (SPEC §21, §50, §58) —————————————————————————————

  private register(ctx: Context): void {
    // `llm/stream` is a waterfall around every streaming model call (§21).
    // The listener awaits slot preparation (lazy restore, save-before-switch)
    // before invoking `next()`, then returns the transparent stream wrapper.
    ctx.on(
      "llm/stream",
      ((options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) =>
        this.handleStream(options, next)) as never,
      { global: true },
    );

    // Session lifecycle hooks through a structural registration (the
    // `session/*` event vocabulary belongs to the host's session service).
    registerHostEvent(ctx, "session/flush", (session: { readonly id: string }) =>
      this.coordinator.checkpoint(String(session.id), "session-flush").catch(() => undefined),
    );
    registerHostEvent(ctx, "session/disposed", (session: { readonly id: string }) => {
      void this.coordinator.handleSessionDisposed(String(session.id)).catch(() => undefined);
    });
    registerHostEvent(
      ctx,
      "session/event",
      (session: { readonly id: string }, event: { readonly type: string }) => {
        if (event.type !== "turn/end") return;
        void this.coordinator.checkpoint(String(session.id), "turn-end").catch(() => undefined);
      },
    );

    // Backend probe + shutdown checkpoint through a proper Cordis effect
    // (SPEC §34, §58): the disposer runs when the owning fiber unloads.
    ctx.effect(() => {
      void this.coordinator.probeBackend().catch(() => undefined);
      return async () => {
        await this.coordinator.dispose();
      };
    }, "dsh-kv-persist.lifecycle");
  }

  /**
   * Prepare the slot, then wrap the downstream stream (SPEC §23, §25).
   * `next()` is invoked exactly once, after preparation, inside the slot
   * lease; chunks pass through unchanged and unbuffered.
   */
  private async handleStream(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): Promise<AsyncIterable<StreamChunk>> {
    if (!this.handles(options.provider)) return next();
    return this.coordinator.runSessionRequest({
      sessionId: options.sessionId === undefined ? null : String(options.sessionId),
      provider: options.provider,
      model: options.model,
      purpose: options.purpose,
      next,
    });
  }

  private async checkMetadataWritable(): Promise<{ name: string; ok: boolean; detail: string }> {
    const dir = resolveMetadataDir(this.config);
    const probeFile = join(dir, `.probe-${process.pid}-${Date.now().toString(36)}`);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(probeFile, "probe\n", "utf8");
      await rm(probeFile, { force: true });
      return { name: "metadata-dir", ok: true, detail: `${dir} is writable` };
    } catch (error) {
      return {
        name: "metadata-dir",
        ok: false,
        detail: `${dir} is not writable: ${String((error as Error)?.message ?? error)}`,
      };
    }
  }
}
