/**
 * Backend abstraction (SPEC §12): the coordinator never issues `/slots`
 * HTTP calls directly; it only talks to `KvPersistenceBackend`.
 */

/** Server-reported slot view (SPEC §19 input). */
export interface BackendSlot {
  readonly id: number;
}

/** Static + probed capabilities of one backend instance. */
export interface BackendCapabilities {
  readonly kind: string;
  /** The slots endpoint answered and slot geometry looks usable. */
  readonly slotsAvailable: boolean;
  /** Slot ids the server currently exposes. */
  readonly slotIds: readonly number[];
  /** Raw server build/version string when discoverable, else null. */
  readonly serverVersion: string | null;
}

export interface BackendSaveResult {
  readonly success: boolean;
  /** Server-reported snapshot size in bytes when discoverable. */
  readonly bytes: number | null;
}

export interface BackendRestoreResult {
  readonly success: boolean;
  /** llama.cpp reports how many tokens were restored (SPEC §24). */
  readonly nRestored: number | null;
}

export interface BackendEraseResult {
  readonly success: boolean;
}

/**
 * Backend-neutral persistence surface (SPEC §12). Core code never issues
 * `/slots` HTTP calls; it only talks to this interface.
 */
export interface KvPersistenceBackend {
  readonly kind: string;

  /** Health/capability probe (SPEC §34). */
  probe(signal?: AbortSignal): Promise<BackendCapabilities>;

  /** List the physical slots the server currently exposes. */
  inspectSlots(signal?: AbortSignal): Promise<readonly BackendSlot[]>;

  /**
   * Persist slot KV state into a server-side snapshot file.
   * `snapshotKey` is the opaque plugin-generated filename (SPEC §16, §44).
   */
  saveSlot(slotId: number, snapshotKey: string, signal?: AbortSignal): Promise<BackendSaveResult>;

  /** Load a snapshot back into the slot. */
  restoreSlot(
    slotId: number,
    snapshotKey: string,
    signal?: AbortSignal,
  ): Promise<BackendRestoreResult>;

  /** Clear the slot KV state. */
  eraseSlot(slotId: number, signal?: AbortSignal): Promise<BackendEraseResult>;
}


