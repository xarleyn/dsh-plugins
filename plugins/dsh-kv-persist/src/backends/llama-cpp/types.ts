/**
 * Wire types of the llama.cpp `/slots` management API (SPEC §6).
 *
 * Parsing is defensive: fields the plugin cannot rely on across llama.cpp
 * builds are optional, and unknown response shapes degrade to `null`
 * instead of throwing.
 */

/** GET /slots response entry (defensive view). */
export interface LlamaCppSlotView {
  readonly id: number;
}

/** Normalized GET /slots response. */
export interface LlamaCppSlotsResponse {
  readonly slots: readonly LlamaCppSlotView[];
}

/** POST /slots/{id}?action=save response. */
export interface LlamaCppSaveResponse {
  readonly success: boolean;
}

/** POST /slots/{id}?action=restore response. */
export interface LlamaCppRestoreResponse {
  readonly success: boolean;
  /** Token count reported by the server, when present (SPEC §24). */
  readonly nRestored: number | null;
}

/** POST /slots/{id}?action=erase response. */
export interface LlamaCppEraseResponse {
  readonly success: boolean;
}
