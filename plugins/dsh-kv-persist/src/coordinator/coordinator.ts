/**
 * Single-slot coordinator (SPEC §7, §20-§29, §50-§53, §69-§72).
 *
 * Owns the mapping `DSH session -> llama.cpp slot -> persistent snapshot`
 * for exactly one physical slot. All slot mutations run inside one slot
 * mutex (Invariant 8); the session log of DSH remains the only source of
 * truth and every persistence failure degrades to cold inference
 * (Invariants 1, 5).
 */

import type { StreamChunk } from "@deepseek-ai/dsh-llm";

import type { KvPersistenceBackend } from "../backends/types.js";
import type { ResolvedKvPersistConfig } from "../config.js";
import { buildSnapshotIdentity } from "../snapshots/fingerprint.js";
import type { SnapshotIdentity } from "../snapshots/fingerprint.js";
import { assertPluginGeneratedFilename, snapshotFilename } from "../snapshots/naming.js";
import type { SnapshotRepository } from "../snapshots/repository.js";
import type { KvPersistLogger } from "../observability/diagnostics.js";
import { abbreviateSessionId } from "../observability/diagnostics.js";
import type { KvPersistMetrics } from "../observability/metrics.js";
import { KvPersistError, KvRestoreFailedError } from "../errors.js";
import type { SnapshotInvalidationReason } from "../errors.js";
import { CheckpointPolicy } from "./checkpoint-policy.js";
import type { CheckpointTrigger } from "./checkpoint-policy.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { SlotMutex } from "./slot-lease.js";
import {
  createManagedSlot,
  createSessionRuntime,
  isDirty,
  markDirty,
  markPersisted,
} from "./state-machine.js";
import type {
  ManagedSlot,
  RestoreOutcome,
  SessionRuntime,
  SnapshotResult,
} from "./state-machine.js";

/** One coordinated llm/stream request. */
export interface CoordinatorRequest {
  /** DSH session identity; null for requests outside any session. */
  readonly sessionId: string | null;
  readonly provider: string;
  readonly model: string;
  /** Auxiliary classification (compaction, session-title); set for aux calls. */
  readonly purpose?: string;
  /** Waterfall continuation producing the downstream stream; called once. */
  readonly next: () => AsyncIterable<StreamChunk>;
}

export interface CoordinatorOptions {
  readonly config: ResolvedKvPersistConfig;
  readonly backend: KvPersistenceBackend;
  readonly repository: SnapshotRepository;
  readonly metrics: KvPersistMetrics;
  readonly logger: KvPersistLogger;
  readonly now?: () => number;
}

export class SingleSlotCoordinator {
  readonly #config: ResolvedKvPersistConfig;
  readonly #backend: KvPersistenceBackend;
  readonly #repository: SnapshotRepository;
  readonly #metrics: KvPersistMetrics;
  readonly #logger: KvPersistLogger;
  readonly #mutex: SlotMutex;
  readonly #policy: CheckpointPolicy;
  readonly #breaker: CircuitBreaker;
  readonly #slot: ManagedSlot;
  readonly #sessions = new Map<string, SessionRuntime>();
  readonly #now: () => number;

  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #idleTimerSession: string | null = null;
  #disposed = false;

  constructor(options: CoordinatorOptions) {
    this.#config = options.config;
    this.#backend = options.backend;
    this.#repository = options.repository;
    this.#metrics = options.metrics;
    this.#logger = options.logger;
    this.#now = options.now ?? Date.now;
    this.#mutex = new SlotMutex(`llama-slot-${options.config.slotId}`);
    this.#policy = new CheckpointPolicy(options.config);
    this.#breaker = new CircuitBreaker({
      maxConsecutiveFailures: options.config.failure.maxConsecutiveFailures,
      cooldownMs: options.config.failure.cooldownMs,
    });
    this.#slot = createManagedSlot(options.config.slotId);
  }

  // ——— introspection (status API, SPEC §47) ———————————————————————————

  get slot(): Readonly<ManagedSlot> {
    return this.#slot;
  }

  get circuitState(): string {
    return this.#breaker.state;
  }

  getSessionState(sessionId: string): SessionRuntime | undefined {
    return this.#sessions.get(sessionId);
  }

  // ——— request coordination (SPEC §21, §22, §69-§72) ——————————————————

  /**
   * Handle one llm/stream request for a managed provider. The returned
   * iterable wraps the downstream stream transparently: every chunk is
   * yielded unchanged, streaming is preserved (SPEC §25), and a successful
   * terminal finish marks the session dirty.
   */
  async runSessionRequest(input: CoordinatorRequest): Promise<AsyncIterable<StreamChunk>> {
    if (input.purpose !== undefined || input.sessionId === null) {
      this.#metrics.counters.auxiliaryRequests += 1;
      return this.#runAuxiliary(input);
    }
    const sessionId: string = input.sessionId;
    this.#ensureRuntime(sessionId, input);
    return this.#mutex.runExclusive(async () => {
      this.#cancelIdleTimer();
      if (this.#breaker.isOpen(this.#now())) {
        this.#metrics.counters.circuitSkips += 1;
        this.#logger.debug("kv.persistence.circuit_open", { sessionId });
        this.#loseSlotTracking();
        return this.#execute(input);
      }
      const identity = this.#identityFor(sessionId, input);
      const outcome = await this.#prepareSession(sessionId, identity);
      if (this.#config.failure.strict && outcome.kind === "cold-fallback") {
        // SPEC §32: only strict mode turns a restore failure into a failure.
        throw new KvRestoreFailedError(
          `strict mode: snapshot restore failed for session ${abbreviateSessionId(sessionId)}: ${outcome.error ?? "unknown error"}`,
        );
      }
      if (this.#slot.ownerSessionId === sessionId) {
        this.#slot.state = "inference";
        this.#slot.lastUsedAt = this.#now();
      }
      return this.#execute(input);
    });
  }

  /**
   * Auxiliary requests (session-title, compaction) participate explicitly
   * (SPEC §22, §72): the current dirty owner is checkpointed, ownership is
   * cleared, and the auxiliary result never becomes session state
   * (Invariant 7).
   */
  async #runAuxiliary(input: CoordinatorRequest): Promise<AsyncIterable<StreamChunk>> {
    return this.#mutex.runExclusive(async () => {
      this.#cancelIdleTimer();
      if (this.#breaker.isOpen(this.#now())) {
        this.#metrics.counters.circuitSkips += 1;
        this.#loseSlotTracking();
        return this.#execute(input);
      }
      const owner = this.#slot.ownerSessionId;
      if (owner !== null) {
        if (this.#policy.shouldCheckpoint(this.#sessions.get(owner), "switch")) {
          await this.#saveOwnedSession(owner, "switch");
        }
        this.#slot.ownerSessionId = null;
        this.#slot.state = "idle";
        this.#logger.debug("kv.session.switch", { sessionId: owner, to: "auxiliary" });
      }
      return this.#execute(input);
    });
  }

  /**
   * The core prepare algorithm (SPEC §23): already-active fast path with
   * zero disk I/O (Invariant 6), save-before-evict (Invariant 3), lazy
   * restore of a compatible snapshot, or a safe cold assignment.
   */
  async #prepareSession(sessionId: string, identity: SnapshotIdentity): Promise<RestoreOutcome> {
    const runtime = this.#requireRuntime(sessionId);

    // 1. Resident fast path: no save, no restore, no management calls.
    if (
      this.#slot.ownerSessionId === sessionId &&
      this.#slot.state !== "broken" &&
      this.#slot.state !== "unknown"
    ) {
      runtime.lifecycle = isDirty(runtime) ? "active-dirty" : "active-clean";
      return { kind: "already-active", sessionId, tokens: null, bytes: null, durationMs: null, error: null };
    }

    // 2. Save-before-evict (SPEC §52, Invariant 3).
    const owner = this.#slot.ownerSessionId;
    if (owner !== null && owner !== sessionId) {
      this.#metrics.counters.slotSwitches += 1;
      if (this.#policy.shouldCheckpoint(this.#sessions.get(owner), "switch")) {
        await this.#saveOwnedSession(owner, "switch");
      }
    }

    // 3. No compatible snapshot (or restore disabled) -> cold assignment (§53).
    const manifest = this.#config.restore.enabled
      ? await this.#findCompatibleManifest(identity)
      : null;
    if (!manifest) {
      await this.#eraseSlotBestEffort();
      this.#assignSlot(sessionId, "idle");
      runtime.lifecycle = "cold";
      this.#metrics.counters.coldPrefills += 1;
      this.#logger.info("kv.session.cold", { sessionId, slot: this.#slot.id });
      return { kind: "cold", sessionId, tokens: null, bytes: null, durationMs: null, error: null };
    }

    // 4. Lazy restore (SPEC §23-§24).
    const startedAt = this.#now();
    this.#slot.state = "restoring";
    runtime.lifecycle = "restoring";
    this.#logger.debug("kv.session.restore.start", { sessionId, slot: this.#slot.id });
    try {
      assertPluginGeneratedFilename(manifest.snapshotFilename);
      const result = await this.#backend.restoreSlot(this.#slot.id, manifest.snapshotFilename);
      if (this.#config.restore.verify && result.nRestored !== null && result.nRestored <= 0) {
        throw new KvRestoreFailedError(
          `restore verification failed: server reported n_restored=${String(result.nRestored)} (SPEC §24)`,
        );
      }
      const durationMs = this.#now() - startedAt;
      this.#assignSlot(sessionId, "ready");
      runtime.lifecycle = "active-clean";
      this.#metrics.counters.restores += 1;
      this.#metrics.counters.restoreHits += 1;
      this.#metrics.counters.restoreDurationMs += durationMs;
      this.#breaker.recordSuccess();
      this.#logger.info("kv.session.restore.success", {
        sessionId,
        slot: this.#slot.id,
        tokens: result.nRestored,
        durationMs,
      });
      return {
        kind: "restored",
        sessionId,
        tokens: result.nRestored,
        bytes: manifest.bytes,
        durationMs,
        error: null,
      };
    } catch (error) {
      // Restore failure is never fatal unless strict mode (SPEC §23, §32).
      const message = error instanceof Error ? error.message : String(error);
      await this.#repository
        .markInvalid(identity, "RESTORE_FAILED", this.#iso())
        .catch(() => undefined);
      await this.#eraseSlotBestEffort();
      this.#assignSlot(sessionId, "idle");
      runtime.lifecycle = "cold";
      this.#metrics.counters.restoreFailures += 1;
      this.#metrics.counters.coldPrefills += 1;
      this.#breaker.recordFailure(this.#now());
      this.#logger.warn("kv.session.restore.failed", {
        sessionId,
        code: error instanceof KvPersistError ? error.code : "KV_RESTORE_FAILED",
        error: message,
      });
      return { kind: "cold-fallback", sessionId, tokens: null, bytes: null, durationMs: null, error: message };
    }
  }

  /**
   * Wrap the downstream stream (SPEC §25): chunks pass through unchanged
   * and unbuffered; only the terminal state is observed. `next()` was
   * already invoked exactly once inside the lock before wrapping.
   */
  #execute(input: CoordinatorRequest): AsyncIterable<StreamChunk> {
    const downstream = input.next();
    const sessionId = input.purpose === undefined ? input.sessionId : null;
    const finish = (succeeded: boolean): void => {
      if (succeeded && sessionId !== null) this.#onInferenceSuccess(sessionId);
    };
    async function* wrapped(): AsyncIterable<StreamChunk> {
      let succeeded = false;
      try {
        for await (const chunk of downstream) {
          if (
            chunk.type === "finish" &&
            chunk.reason.kind !== "error" &&
            chunk.reason.kind !== "aborted"
          ) {
            succeeded = true;
          }
          yield chunk;
        }
      } finally {
        finish(succeeded);
      }
    }
    return wrapped();
  }

  /** Post-inference bookkeeping: dirty generation + idle checkpoint timer. */
  #onInferenceSuccess(sessionId: string): void {
    const runtime = this.#sessions.get(sessionId);
    if (runtime !== undefined) markDirty(runtime);
    // Recheck ownership: a switch may have happened while the stream was open.
    if (this.#slot.ownerSessionId === sessionId) {
      this.#slot.state = "dirty";
      this.#slot.lastUsedAt = this.#now();
      this.#scheduleIdleCheckpoint(sessionId);
    }
  }

  // ——— checkpointing (SPEC §26-§28, §71) ———————————————————————————————

  /**
   * Save the session that owns the slot, with generation coalescing:
   * a clean session is skipped and an in-flight save for the same
   * generation is awaited rather than duplicated (SPEC §27).
   */
  async #saveOwnedSession(sessionId: string, trigger: CheckpointTrigger): Promise<SnapshotResult> {
    const runtime = this.#sessions.get(sessionId);
    if (runtime === undefined || !isDirty(runtime)) {
      return { kind: "skipped-clean", sessionId, revision: runtime?.persistedRevision ?? 0, bytes: null, error: null };
    }
    if (this.#slot.ownerSessionId !== sessionId) {
      return { kind: "skipped-not-owner", sessionId, revision: runtime.dirtyRevision, bytes: null, error: null };
    }
    if (runtime.saveInFlight !== null) return runtime.saveInFlight;

    const identity = this.#identityFor(sessionId, runtime.route);
    const generation = runtime.dirtyRevision;
    const startedAt = this.#now();
    this.#slot.state = "saving";
    runtime.lifecycle = "saving";
    this.#logger.debug("kv.session.save.start", { sessionId, trigger });

    const attempt = (async (): Promise<SnapshotResult> => {
      try {
        assertPluginGeneratedFilename(snapshotFilename(identity));
        const saved = await this.#backend.saveSlot(this.#slot.id, snapshotFilename(identity));
        await this.#repository.put({
          identity,
          slotId: this.#slot.id,
          sessionSeq: null,
          tokens: null,
          bytes: saved.bytes,
          now: this.#iso(),
        });
        markPersisted(runtime, generation);
        if (this.#slot.ownerSessionId === sessionId) this.#slot.state = "ready";
        this.#breaker.recordSuccess();
        const durationMs = this.#now() - startedAt;
        this.#metrics.counters.saves += 1;
        this.#metrics.counters.saveDurationMs += durationMs;
        this.#logger.info("kv.session.save.success", {
          sessionId,
          trigger,
          revision: generation,
          durationMs,
        });
        return { kind: "saved", sessionId, revision: generation, bytes: saved.bytes, error: null };
      } catch (error) {
        // Save failure never fails the session (SPEC §32): stay dirty, log.
        this.#breaker.recordFailure(this.#now());
        this.#metrics.counters.saveFailures += 1;
        if (this.#slot.ownerSessionId === sessionId) this.#slot.state = "dirty";
        runtime.lifecycle = "active-dirty";
        const message = error instanceof Error ? error.message : String(error);
        this.#logger.warn("kv.session.save.failed", {
          sessionId,
          trigger,
          code: error instanceof KvPersistError ? error.code : "KV_SAVE_FAILED",
          error: message,
        });
        return { kind: "failed", sessionId, revision: generation, bytes: null, error: message };
      } finally {
        runtime.saveInFlight = null;
      }
    })();
    runtime.saveInFlight = attempt;
    return attempt;
  }

  /** Public checkpoint entry for triggers coming from session events. */
  async checkpoint(sessionId: string, trigger: CheckpointTrigger): Promise<SnapshotResult | null> {
    if (this.#disposed) return null;
    return this.#mutex.runExclusive(async () => {
      if (!this.#policy.shouldCheckpoint(this.#sessions.get(sessionId), trigger)) return null;
      if (this.#breaker.isOpen(this.#now())) return null;
      return this.#saveOwnedSession(sessionId, trigger);
    });
  }

  /** Session disposal (SPEC §50): checkpoint if configured, release, forget. */
  async handleSessionDisposed(sessionId: string): Promise<void> {
    if (this.#disposed) return;
    await this.#mutex.runExclusive(async () => {
      const runtime = this.#sessions.get(sessionId);
      if (
        runtime !== undefined &&
        this.#slot.ownerSessionId === sessionId &&
        this.#policy.shouldCheckpoint(runtime, "session-disposed") &&
        !this.#breaker.isOpen(this.#now())
      ) {
        await this.#saveOwnedSession(sessionId, "session-disposed");
      }
      if (this.#slot.ownerSessionId === sessionId) {
        this.#slot.ownerSessionId = null;
        this.#slot.state = "idle";
      }
      this.#sessions.delete(sessionId);
      if (this.#idleTimerSession === sessionId) this.#cancelIdleTimer();
    });
  }

  /** Save every dirty session that still owns the slot (flush/shutdown). */
  async flushOwned(trigger: CheckpointTrigger): Promise<void> {
    if (this.#disposed) return;
    await this.#mutex.runExclusive(async () => {
      const owner = this.#slot.ownerSessionId;
      if (owner === null) return;
      if (!this.#policy.shouldCheckpoint(this.#sessions.get(owner), trigger)) return;
      if (this.#breaker.isOpen(this.#now())) return;
      await this.#saveOwnedSession(owner, trigger);
    });
  }

  /** Idle checkpoint (SPEC §71): recheck ownership before saving. */
  #scheduleIdleCheckpoint(sessionId: string): void {
    this.#cancelIdleTimer();
    if (this.#config.checkpoint.idleMs <= 0) return;
    this.#idleTimerSession = sessionId;
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = null;
      this.#idleTimerSession = null;
      void this.#mutex.runExclusive(async () => {
        if (this.#disposed) return;
        if (this.#slot.ownerSessionId !== sessionId) return;
        const runtime = this.#sessions.get(sessionId);
        if (!this.#policy.shouldCheckpoint(runtime, "idle")) return;
        if (this.#breaker.isOpen(this.#now())) return;
        await this.#saveOwnedSession(sessionId, "idle");
      });
    }, this.#config.checkpoint.idleMs);
    // The timer must never keep the host process alive.
    this.#idleTimer.unref?.();
  }

  #cancelIdleTimer(): void {
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
      this.#idleTimerSession = null;
    }
  }

  // ——— management API surface (SPEC §11) ———————————————————————————————

  /** Explicit restore for the service API (SPEC §11 `restore`). */
  async restoreNow(sessionId: string): Promise<RestoreOutcome> {
    return this.#mutex.runExclusive(async () => {
      const runtime = this.#sessions.get(sessionId);
      if (runtime === undefined) {
        return { kind: "cold", sessionId, tokens: null, bytes: null, durationMs: null, error: "no known route for session" };
      }
      if (this.#breaker.isOpen(this.#now())) {
        return { kind: "cold-fallback", sessionId, tokens: null, bytes: null, durationMs: null, error: "circuit open" };
      }
      const identity = this.#identityFor(sessionId, runtime.route);
      return this.#prepareSession(sessionId, identity);
    });
  }

  /** Explicit save for the service API (SPEC §11 `save`). */
  async saveNow(sessionId: string): Promise<SnapshotResult> {
    return this.#mutex.runExclusive(async () => {
      if (!this.#policy.shouldCheckpoint(this.#sessions.get(sessionId), "manual")) {
        return { kind: "skipped-clean", sessionId, revision: 0, bytes: null, error: "nothing to save" };
      }
      return this.#saveOwnedSession(sessionId, "manual");
    });
  }

  /** Invalidate every snapshot of a session without deleting data (§31). */
  async invalidate(sessionId: string, reason: SnapshotInvalidationReason = "EXPLICIT"): Promise<void> {
    await this.#mutex.runExclusive(async () => {
      const runtime = this.#sessions.get(sessionId);
      if (runtime !== undefined) runtime.lifecycle = "invalid";
      if (this.#slot.ownerSessionId === sessionId) {
        await this.#eraseSlotBestEffort();
        this.#slot.ownerSessionId = null;
        this.#slot.state = "idle";
      }
      await this.#repository.invalidateSession(sessionId, reason, this.#iso());
      this.#logger.info("kv.snapshot.invalidated", { sessionId, reason });
    });
  }

  /** Purge all metadata of a session (SPEC §11 `purge`). */
  async purge(sessionId: string): Promise<void> {
    await this.#mutex.runExclusive(async () => {
      if (this.#slot.ownerSessionId === sessionId) {
        await this.#eraseSlotBestEffort();
        this.#slot.ownerSessionId = null;
        this.#slot.state = "idle";
      }
      await this.#repository.removeSession(sessionId);
      this.#sessions.delete(sessionId);
    });
  }

  /** Probe the backend (SPEC §34); resets the breaker on success. */
  async probeBackend(): Promise<{ healthy: boolean; slotIds: readonly number[]; error: string | null }> {
    try {
      const capabilities = await this.#backend.probe();
      this.#breaker.recordSuccess();
      this.#logger.info("kv.backend.ready", { slots: capabilities.slotIds.length });
      return { healthy: true, slotIds: capabilities.slotIds, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#logger.warn("kv.backend.unavailable", { error: message });
      return { healthy: false, slotIds: [], error: message };
    }
  }

  /** Shutdown (SPEC §58): stop work, cancel timers, final checkpoint. */
  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#cancelIdleTimer();
    await this.flushOwned("shutdown").catch(() => undefined);
  }

  // ——— internals ———————————————————————————————————————————————————————

  #ensureRuntime(sessionId: string, route: { provider: string; model: string }): SessionRuntime {
    const existing = this.#sessions.get(sessionId);
    if (existing !== undefined) {
      existing.route = { provider: route.provider, model: route.model };
      return existing;
    }
    const runtime = createSessionRuntime(sessionId, route);
    this.#sessions.set(sessionId, runtime);
    return runtime;
  }

  #requireRuntime(sessionId: string): SessionRuntime {
    const runtime = this.#sessions.get(sessionId);
    if (runtime === undefined) {
      throw new KvPersistError("KV_INVARIANT", `missing session runtime for ${abbreviateSessionId(sessionId)}`);
    }
    return runtime;
  }

  #identityFor(
    sessionId: string,
    route: { provider: string; model: string },
  ): SnapshotIdentity {
    return buildSnapshotIdentity({
      sessionId,
      route: { provider: route.provider, model: route.model },
      baseURL: this.#config.baseURL,
      runtimeKey: this.#config.runtimeKey,
    });
  }

  #assignSlot(sessionId: string, state: ManagedSlot["state"]): void {
    const switched = this.#slot.ownerSessionId !== sessionId;
    this.#slot.ownerSessionId = sessionId;
    this.#slot.state = state;
    this.#slot.snapshotRevision = null;
    this.#slot.lastUsedAt = this.#now();
    if (switched) this.#metrics.counters.slotSwitches += 1;
  }

  async #eraseSlotBestEffort(): Promise<void> {
    try {
      await this.#backend.eraseSlot(this.#slot.id);
      this.#metrics.counters.erases += 1;
    } catch (error) {
      // Cold path must continue even when the erase fails (SPEC §32, §53).
      this.#breaker.recordFailure(this.#now());
      this.#logger.warn("kv.slot.erase_failed", {
        slot: this.#slot.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #findCompatibleManifest(identity: SnapshotIdentity) {
    try {
      return await this.#repository.findCompatible(identity);
    } catch (error) {
      // A malformed manifest must not crash the request path (SPEC §32).
      this.#logger.warn("kv.snapshot.manifest_invalid", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** The slot content may have changed unobserved; drop ownership bookkeeping. */
  #loseSlotTracking(): void {
    this.#slot.ownerSessionId = null;
    this.#slot.state = "unknown";
    this.#slot.snapshotRevision = null;
  }

  #iso(): string {
    return new Date(this.#now()).toISOString();
  }
}

