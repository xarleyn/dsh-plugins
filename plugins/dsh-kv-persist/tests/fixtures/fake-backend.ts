/**
 * Deterministic fake backend for coordinator tests (SPEC §77).
 *
 * Simulates the llama.cpp slot surface in memory with failure injection:
 * no network, no GPU, no llama-server required.
 */

import {
  KvBackendUnavailableError,
  KvRestoreFailedError,
  KvSaveFailedError,
} from "../../src/errors.js";
import type {
  BackendCapabilities,
  BackendEraseResult,
  BackendRestoreResult,
  BackendSaveResult,
  BackendSlot,
  KvPersistenceBackend,
} from "../../src/backends/types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FakeKvBackend implements KvPersistenceBackend {
  readonly kind = "fake";

  #slots = new Map<number, string | null>();
  #snapshots = new Map<string, string>();
  #failNextSave = 0;
  #failNextRestore = 0;
  #unavailable = false;
  #restoreDelayMs = 0;
  #nRestored: number | null = 42;

  saveCount = 0;
  restoreCount = 0;
  eraseCount = 0;
  probeCount = 0;
  readonly events: string[] = [];

  constructor(slotCount = 1) {
    for (let id = 0; id < slotCount; id += 1) this.#slots.set(id, null);
  }

  // ——— injection controls (SPEC §77) ————————————————————————————————————

  failNextSave(times = 1): void {
    this.#failNextSave += times;
  }

  failNextRestore(times = 1): void {
    this.#failNextRestore += times;
  }

  setUnavailable(unavailable: boolean): void {
    this.#unavailable = unavailable;
  }

  delayRestore(ms: number): void {
    this.#restoreDelayMs = ms;
  }

  setRestoredTokens(nRestored: number | null): void {
    this.#nRestored = nRestored;
  }

  removeSnapshot(key: string): void {
    this.#snapshots.delete(key);
  }

  corruptSnapshot(key: string): void {
    this.#snapshots.set(key, "corrupt");
  }

  // ——— assertions helpers ———————————————————————————————————————————————

  residentSnapshot(slotId: number): string | null {
    return this.#slots.get(slotId) ?? null;
  }

  hasSnapshot(key: string): boolean {
    return this.#snapshots.has(key);
  }

  // ——— KvPersistenceBackend ——————————————————————————————————————————————

  async probe(): Promise<BackendCapabilities> {
    this.probeCount += 1;
    if (this.#unavailable) throw new KvBackendUnavailableError("fake backend unavailable");
    return { kind: this.kind, slotsAvailable: true, slotIds: [...this.#slots.keys()], serverVersion: null };
  }

  async inspectSlots(): Promise<readonly BackendSlot[]> {
    if (this.#unavailable) throw new KvBackendUnavailableError("fake backend unavailable");
    return [...this.#slots.keys()].map((id) => ({ id }));
  }

  async saveSlot(slotId: number, snapshotKey: string): Promise<BackendSaveResult> {
    this.saveCount += 1;
    this.events.push(`save:${slotId}`);
    if (this.#unavailable) throw new KvBackendUnavailableError("fake backend unavailable");
    if (this.#failNextSave > 0) {
      this.#failNextSave -= 1;
      throw new KvSaveFailedError("injected save failure");
    }
    this.#slots.set(slotId, snapshotKey);
    this.#snapshots.set(snapshotKey, "kv-data");
    return { success: true, bytes: 1024 };
  }

  async restoreSlot(slotId: number, snapshotKey: string): Promise<BackendRestoreResult> {
    this.restoreCount += 1;
    this.events.push(`restore:${slotId}`);
    if (this.#unavailable) throw new KvBackendUnavailableError("fake backend unavailable");
    if (this.#failNextRestore > 0) {
      this.#failNextRestore -= 1;
      throw new KvRestoreFailedError("injected restore failure");
    }
    if (this.#restoreDelayMs > 0) await sleep(this.#restoreDelayMs);
    if (!this.#snapshots.has(snapshotKey)) {
      throw new KvRestoreFailedError(`snapshot ${snapshotKey} missing on server`);
    }
    if (this.#snapshots.get(snapshotKey) === "corrupt") {
      throw new KvRestoreFailedError(`snapshot ${snapshotKey} is corrupt`);
    }
    this.#slots.set(slotId, snapshotKey);
    return { success: true, nRestored: this.#nRestored };
  }

  async eraseSlot(slotId: number): Promise<BackendEraseResult> {
    this.eraseCount += 1;
    this.events.push(`erase:${slotId}`);
    if (this.#unavailable) throw new KvBackendUnavailableError("fake backend unavailable");
    this.#slots.set(slotId, null);
    return { success: true };
  }
}
