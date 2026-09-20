/**
 * Archive retention (result-shaping SPEC §24).
 *
 * Collection is lazy and never on the shaping path: it runs after a write, or
 * on demand, and it stops at the first failure instead of escalating. The rule
 * is oldest-first — the newest originals are the ones a user is most likely to
 * want after noticing a shaped result, so they are the last to go.
 */

import type { ResolvedJevCompactionConfig } from "../config.js";
import type { LocalResultArchive } from "./local.js";

/** What one collection pass did. */
export interface GcReport {
  readonly deleted: number;
  readonly bytesFreed: number;
  readonly kept: number;
  readonly errors: number;
}

const KEEP_EVERYTHING: GcReport = Object.freeze({
  deleted: 0,
  bytesFreed: 0,
  kept: 0,
  errors: 0,
});

/**
 * Enforce `retentionDays` and `maxBytes`. Both limits default to "no limit"
 * when zero, and a zero-byte ceiling is treated as unset rather than as
 * "delete everything": a misconfigured retention must never be destructive.
 */
export async function collectArchive(
  archive: LocalResultArchive,
  config: ResolvedJevCompactionConfig,
): Promise<GcReport> {
  const { retentionDays, maxBytes } = config.archive;
  if (retentionDays <= 0 && maxBytes <= 0) return KEEP_EVERYTHING;

  const entries = await archive.list();
  if (entries.length === 0) return KEEP_EVERYTHING;

  const cutoff =
    retentionDays > 0
      ? Date.now() - retentionDays * 24 * 60 * 60 * 1000
      : undefined;

  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  let deleted = 0;
  let bytesFreed = 0;
  let errors = 0;
  let kept = 0;

  for (const entry of entries) {
    const tooOld = cutoff !== undefined && entry.mtimeMs < cutoff;
    const overSize = maxBytes > 0 && total > maxBytes;
    if (!tooOld && !overSize) {
      kept += 1;
      continue;
    }
    try {
      await archive.delete(entry.ref);
      deleted += 1;
      bytesFreed += entry.bytes;
      total -= entry.bytes;
    } catch {
      // A failed unlink is not worth failing the collection over; count it and
      // keep going so one locked file cannot pin the whole archive.
      errors += 1;
    }
  }

  return { deleted, bytesFreed, kept, errors };
}
