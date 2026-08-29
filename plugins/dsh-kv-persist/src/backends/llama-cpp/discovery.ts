/**
 * Backend discovery / health probe (SPEC §34).
 *
 * The probe explicitly distinguishes "LLM endpoint alive" from "KV
 * persistence supported": the plugin degrades to cold inference unless the
 * slots endpoint answers with the expected geometry.
 */

import { KvBackendUnavailableError } from "../../errors.js";
import type { LlamaCppClient } from "./client.js";
import type { BackendCapabilities } from "../types.js";

export interface ProbeExpectation {
  /** Slot that single-slot mode requires (usually 0). */
  readonly requiredSlotId: number;
}

/**
 * Probe the server: reachable, `/slots` available, expected slot present.
 * Throws `KV_BACKEND_UNAVAILABLE` on any hard failure; capability details
 * are returned otherwise.
 */
export async function probeServer(
  client: LlamaCppClient,
  expectation: ProbeExpectation,
): Promise<BackendCapabilities> {
  let response;
  try {
    response = await client.inspectSlots();
  } catch (error) {
    throw new KvBackendUnavailableError(
      `slot probing failed: ${String((error as Error)?.message ?? error)}`,
      { cause: error },
    );
  }
  const slotIds = response.slots.map((slot) => slot.id);
  if (!slotIds.includes(expectation.requiredSlotId)) {
    throw new KvBackendUnavailableError(
      `server exposes slots [${slotIds.join(", ")}] but configured slot ${expectation.requiredSlotId} is missing; start llama-server with --slots/--parallel >= ${expectation.requiredSlotId + 1}`,
    );
  }
  return {
    kind: "llama.cpp",
    slotsAvailable: true,
    slotIds,
    serverVersion: null,
  };
}
