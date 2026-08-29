/**
 * Persistence metrics counters (SPEC §46, MVP subset).
 *
 * Counters are in-memory only in v0.1; they surface through
 * `ctx.kvPersist.status()` and later optional Prometheus integration.
 */

export interface KvPersistCounters {
  /** Restore attempts that ended successfully (§46 dsh_kv_restore_total). */
  restores: number;
  /** Successful restores of an existing snapshot (§46 restore_hit_total). */
  restoreHits: number;
  /** Failed restores (§46 restore_failure_total). */
  restoreFailures: number;
  /** Requests served without any snapshot (§46 cold_prefill_total). */
  coldPrefills: number;
  /** Successful saves (§46 save_total). */
  saves: number;
  /** Failed saves (§46 save_failure_total). */
  saveFailures: number;
  /** Successful slot erases. */
  erases: number;
  /** Slot owner switches (§46 slot_switch_total). */
  slotSwitches: number;
  /** Auxiliary requests that went through coordination. */
  auxiliaryRequests: number;
  /** Requests skipped because the circuit was open. */
  circuitSkips: number;
  /** Cumulative restore duration in milliseconds. */
  restoreDurationMs: number;
  /** Cumulative save duration in milliseconds. */
  saveDurationMs: number;
}

type MutableCounters = { -readonly [K in keyof KvPersistCounters]: KvPersistCounters[K] };

export class KvPersistMetrics {
  readonly #counters: MutableCounters = {
    restores: 0,
    restoreHits: 0,
    restoreFailures: 0,
    coldPrefills: 0,
    saves: 0,
    saveFailures: 0,
    erases: 0,
    slotSwitches: 0,
    auxiliaryRequests: 0,
    circuitSkips: 0,
    restoreDurationMs: 0,
    saveDurationMs: 0,
  };

  get counters(): KvPersistCounters {
    return this.#counters;
  }

  snapshot(): KvPersistCounters {
    return { ...this.#counters };
  }
}
