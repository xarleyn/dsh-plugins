/**
 * Snapshot filename generation (SPEC §16, §41, Invariant 9).
 *
 * Filenames are plugin-generated opaque identifiers: sha256 over the
 * identity tuple. Raw session ids, titles, or user input never become
 * filenames, so there are no unsafe characters, no path traversal, and no
 * leaked chat titles.
 */

import { sha256Hex } from "./fingerprint.js";
import type { SnapshotIdentity } from "./fingerprint.js";
import { KvInvariantError } from "../errors.js";

/** One rolling snapshot per (session, route) pair by default (SPEC §41). */
export function snapshotFilename(identity: SnapshotIdentity): string {
  const digest = sha256Hex(
    [
      identity.serverInstanceKey,
      identity.provider,
      identity.model,
      identity.sessionId,
    ].join("\u0000"),
  );
  // Sharded flat name: fixed length, safe characters, no directories needed
  // by the server-side save path.
  return `${digest}.bin`;
}

/**
 * Validate that a filename reaching the backend is plugin-shaped (SPEC §44):
 * hex stem + `.bin`, no separators, no traversal. Defense in depth — the
 * plugin never accepts external filenames, but the guard is cheap.
 */
export function assertPluginGeneratedFilename(filename: string): void {
  if (!/^[0-9a-f]{64}\.bin$/.test(filename)) {
    throw new KvInvariantError(
      `refusing non-plugin snapshot filename: ${JSON.stringify(filename.slice(0, 64))}`,
    );
  }
}
