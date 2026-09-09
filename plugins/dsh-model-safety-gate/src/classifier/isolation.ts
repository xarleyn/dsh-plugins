/**
 * Process-local classifier bypass marker (design SPEC §8).
 *
 * Classifier calls are issued through the host LLM runtime, so without a
 * marker the plugin's own `llm/stream` wrapper would moderate the moderator
 * and recurse forever. The marker is an AsyncLocalStorage context — never a
 * model-name or provider-name comparison, which a caller could spoof.
 *
 * Constraint: the ALS scope must wrap the awaited iteration of the classifier
 * stream, so the whole `classify*` call runs inside `runIsolated`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface SafetyInternalContext {
  readonly safetyInternal: true;
}

const storage = new AsyncLocalStorage<SafetyInternalContext>();

/** Run `fn` marked as plugin-internal classifier traffic. */
export function runIsolated<T>(fn: () => T): T {
  return storage.run({ safetyInternal: true }, fn);
}

/** True when the current async context is plugin-internal classifier traffic. */
export function isSafetyInternal(): boolean {
  return storage.getStore()?.safetyInternal === true;
}
