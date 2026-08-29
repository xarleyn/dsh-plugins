/**
 * Runtime fingerprints and snapshot identity (SPEC §13-§15).
 *
 * A snapshot is never identified by sessionId alone: the identity binds the
 * server instance, provider, model, and a compatibility generation. The
 * runtime fingerprint is the compatibility gate (SPEC Invariant 4) — a
 * snapshot is restored only when the fingerprint matches.
 */

import { createHash } from "node:crypto";
import { KvInvariantError } from "../errors.js";

/** Plugin snapshot schema generation; bump on incompatible manifest changes. */
export const SNAPSHOT_SCHEMA_GENERATION = 1;

/** Identity of one snapshot (SPEC §13). */
export interface SnapshotIdentity {
  readonly sessionId: string;
  readonly provider: string;
  readonly model: string;
  readonly backend: "llama.cpp";
  /** Stable key of the server instance (v0.1: derived from the endpoint). */
  readonly serverInstanceKey: string;
  /** Compatibility generation (SPEC §15). */
  readonly compatibilityVersion: string;
}

/** The request route a session is currently using. */
export interface SessionRoute {
  readonly provider: string;
  readonly model: string;
}

/** sha256 hex digest of a string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Server instance key for v0.1: one configured endpoint, keyed by its
 * origin (`method://host:port`). Multiple servers arrive with v0.3.
 */
export function deriveServerInstanceKey(baseURL: string): string {
  let origin: string;
  try {
    origin = new URL(baseURL).origin;
  } catch {
    throw new KvInvariantError(`backend.baseURL is not a valid URL: "${baseURL}"`);
  }
  return `llama-${sha256Hex(origin).slice(0, 12)}`;
}

/**
 * Compatibility generation (SPEC §15): runtimeKey escape hatch + model +
 * schema generation. Changing `runtimeKey` makes old snapshots invisible
 * without deleting them.
 */
export function compatibilityVersion(options: {
  readonly backend: "llama.cpp";
  readonly runtimeKey: string | null;
  readonly model: string;
}): string {
  return sha256Hex(
    JSON.stringify([
      options.backend,
      // null and "" mean "no explicit runtime key" and must hash identically.
      options.runtimeKey ?? "",
      options.model,
      SNAPSHOT_SCHEMA_GENERATION,
    ]),
  ).slice(0, 16);
}

/** Build the full snapshot identity for one (session, route) pair. */
export function buildSnapshotIdentity(options: {
  readonly sessionId: string;
  readonly route: SessionRoute;
  readonly baseURL: string;
  readonly runtimeKey: string | null;
}): SnapshotIdentity {
  const backend = "llama.cpp" as const;
  return {
    sessionId: options.sessionId,
    provider: options.route.provider,
    model: options.route.model,
    backend,
    serverInstanceKey: deriveServerInstanceKey(options.baseURL),
    compatibilityVersion: compatibilityVersion({
      backend,
      runtimeKey: options.runtimeKey,
      model: options.route.model,
    }),
  };
}

/** True when a stored identity is compatible with the requested one (SPEC §31). */
export function isIdentityCompatible(
  stored: SnapshotIdentity,
  requested: SnapshotIdentity,
): boolean {
  return (
    stored.backend === requested.backend &&
    stored.serverInstanceKey === requested.serverInstanceKey &&
    stored.provider === requested.provider &&
    stored.model === requested.model &&
    stored.compatibilityVersion === requested.compatibilityVersion
  );
}
