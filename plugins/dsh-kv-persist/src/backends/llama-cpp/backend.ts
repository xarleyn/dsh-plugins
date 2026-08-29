/**
 * llama.cpp backend (SPEC §6, §12): maps the backend-neutral persistence
 * interface onto the llama-server slot save/restore/erase API.
 */

import { LlamaCppClient } from "./client.js";
import type { LlamaCppClientOptions } from "./client.js";
import { probeServer } from "./discovery.js";
import type { ProbeExpectation } from "./discovery.js";
import type {
  BackendCapabilities,
  BackendEraseResult,
  BackendRestoreResult,
  BackendSaveResult,
  BackendSlot,
  KvPersistenceBackend,
} from "../types.js";

/** The only backend kind of v0.1 (SPEC §12). */
export const LLAMA_CPP_BACKEND_KIND = "llama.cpp";

export class LlamaCppBackend implements KvPersistenceBackend {
  readonly kind = LLAMA_CPP_BACKEND_KIND;

  readonly #client: LlamaCppClient;
  readonly #expectation: ProbeExpectation;

  constructor(clientOptions: LlamaCppClientOptions, requiredSlotId: number) {
    this.#client = new LlamaCppClient(clientOptions);
    this.#expectation = { requiredSlotId };
  }

  /** Health/capability probe (SPEC §34). */
  probe(): Promise<BackendCapabilities> {
    return probeServer(this.#client, this.#expectation);
  }

  inspectSlots(): Promise<readonly BackendSlot[]> {
    return this.#client.inspectSlots().then((response) =>
      response.slots.map((slot): BackendSlot => ({ id: slot.id })),
    );
  }

  async saveSlot(slotId: number, snapshotKey: string): Promise<BackendSaveResult> {
    const result = await this.#client.saveSlot(slotId, snapshotKey);
    return { success: result.success, bytes: null };
  }

  async restoreSlot(slotId: number, snapshotKey: string): Promise<BackendRestoreResult> {
    const result = await this.#client.restoreSlot(slotId, snapshotKey);
    return { success: result.success, nRestored: result.nRestored };
  }

  async eraseSlot(slotId: number): Promise<BackendEraseResult> {
    const result = await this.#client.eraseSlot(slotId);
    return { success: result.success };
  }
}
