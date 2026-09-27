/**
 * Detaching the live configuration: the Cordis loader keeps a reference in
 * place of every `.volatile()` field, so one read of the injected config can
 * mix values and references. `plainJevCompactionConfig` collapses the whole
 * object into a plain snapshot; the shapes it moves between live in `types.ts`.
 */

import type { JevCompactionConfig, JevCompactionLiveConfig } from "./types.js";

/** Replace one reference by the snapshot it points at, recursively. */
function detach(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  // A `Volatile` is a frozen `{ get }`; no JSON-shaped config value has a
  // function among its own properties, so this check cannot catch one by accident.
  const ref = value as { get?: unknown };
  if (typeof ref.get === "function") {
    return detach((ref.get as () => unknown)());
  }
  if (Array.isArray(value)) return value.map(detach);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, detach(child)]),
  );
}

/**
 * Take one plain snapshot of the live configuration. Called at the start of
 * every operation, which is what keeps a settings change live without a
 * restart while no run ever sees the configuration move underneath it.
 */
export function plainJevCompactionConfig(
  config: JevCompactionConfig | JevCompactionLiveConfig,
): JevCompactionConfig {
  return detach(config) as JevCompactionConfig;
}
