/**
 * Snapshot metadata manifest (SPEC §14).
 *
 * The manifest is small, local, and independent from the potentially huge
 * binary snapshot file owned by llama-server (SPEC §17). Validation is
 * strict: a malformed manifest is reported (`KV_MANIFEST_INVALID`) instead
 * of being silently repaired or dropped.
 */

import { KvManifestInvalidError } from "../errors.js";
import { isIdentityCompatible } from "./fingerprint.js";
import type { SnapshotIdentity, SessionRoute } from "./fingerprint.js";

/** Lifecycle state of a snapshot (SPEC §18, §31). */
export type SnapshotState = "ready" | "invalid";

/** On-disk manifest for one snapshot. */
export interface SnapshotManifest {
  readonly schemaVersion: 1;

  readonly sessionId: string;
  /** Latest known DSH session sequence at save time (SPEC §29, diagnostic). */
  readonly sessionSeq: number | null;

  readonly provider: string;
  readonly model: string;

  readonly backend: "llama.cpp";
  readonly serverInstanceKey: string;
  readonly compatibilityVersion: string;

  readonly slotId: number;

  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastSavedAt?: string;

  /** Server-reported token/byte counters when known. */
  readonly tokens: number | null;
  readonly bytes: number | null;

  readonly snapshotFilename: string;

  readonly state: SnapshotState;
  readonly invalidReason: string | null;
}

/** Create a fresh manifest for an identity. */
export function createManifest(options: {
  readonly identity: SnapshotIdentity;
  readonly slotId: number;
  readonly snapshotFilename: string;
  readonly sessionSeq: number | null;
  readonly now: string;
}): SnapshotManifest {
  const { identity } = options;
  return {
    schemaVersion: 1,
    sessionId: identity.sessionId,
    sessionSeq: options.sessionSeq,
    provider: identity.provider,
    model: identity.model,
    backend: identity.backend,
    serverInstanceKey: identity.serverInstanceKey,
    compatibilityVersion: identity.compatibilityVersion,
    slotId: options.slotId,
    createdAt: options.now,
    updatedAt: options.now,
    tokens: null,
    bytes: null,
    snapshotFilename: options.snapshotFilename,
    state: "ready",
    invalidReason: null,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIsoString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function optionalInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * Validate an unknown parsed manifest document.
 * Throws `KV_MANIFEST_INVALID` on any schema violation.
 */
export function parseManifest(raw: unknown): SnapshotManifest {
  if (!isObject(raw))
    throw new KvManifestInvalidError("manifest must be a JSON object");
  const fail = (what: string): never => {
    throw new KvManifestInvalidError(
      `manifest field ${what} is missing or malformed`,
    );
  };
  if (raw.schemaVersion !== 1) fail("schemaVersion");
  for (const key of ["sessionId", "provider", "model"] as const) {
    if (typeof raw[key] !== "string" || (raw[key] as string).length === 0)
      fail(key);
  }
  if (raw.backend !== "llama.cpp") fail("backend");
  if (typeof raw.serverInstanceKey !== "string") fail("serverInstanceKey");
  if (typeof raw.compatibilityVersion !== "string")
    fail("compatibilityVersion");
  if (typeof raw.slotId !== "number") fail("slotId");
  if (!isIsoString(raw.createdAt)) fail("createdAt");
  if (!isIsoString(raw.updatedAt)) fail("updatedAt");
  if (raw.lastSavedAt !== undefined && !isIsoString(raw.lastSavedAt))
    fail("lastSavedAt");
  if (
    typeof raw.snapshotFilename !== "string" ||
    raw.snapshotFilename.length === 0
  ) {
    fail("snapshotFilename");
  }
  if (raw.state !== "ready" && raw.state !== "invalid") fail("state");
  if (raw.invalidReason !== null && typeof raw.invalidReason !== "string")
    fail("invalidReason");
  if (raw.sessionSeq !== null && typeof raw.sessionSeq !== "number")
    fail("sessionSeq");
  if (raw.tokens !== null && typeof raw.tokens !== "number") fail("tokens");
  if (raw.bytes !== null && typeof raw.bytes !== "number") fail("bytes");
  return {
    schemaVersion: 1,
    sessionId: raw.sessionId as string,
    sessionSeq: optionalInt(raw.sessionSeq),
    provider: raw.provider as string,
    model: raw.model as string,
    backend: "llama.cpp",
    serverInstanceKey: raw.serverInstanceKey as string,
    compatibilityVersion: raw.compatibilityVersion as string,
    slotId: raw.slotId as number,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    ...(typeof raw.lastSavedAt === "string"
      ? { lastSavedAt: raw.lastSavedAt }
      : {}),
    tokens: optionalInt(raw.tokens),
    bytes: optionalInt(raw.bytes),
    snapshotFilename: raw.snapshotFilename as string,
    state: raw.state as SnapshotState,
    invalidReason: raw.invalidReason as string | null,
  };
}

/** True when the manifest can serve the requested route (SPEC Invariant 4). */
export function isManifestCompatible(
  manifest: SnapshotManifest,
  identity: SnapshotIdentity,
): boolean {
  return (
    manifest.state === "ready" &&
    isIdentityCompatible(
      {
        sessionId: manifest.sessionId,
        provider: manifest.provider,
        model: manifest.model,
        backend: manifest.backend,
        serverInstanceKey: manifest.serverInstanceKey,
        compatibilityVersion: manifest.compatibilityVersion,
      },
      identity,
    )
  );
}

/**
 * Route key under which a manifest is stored. The separator is a NUL written
 * as an escape sequence: a literal one makes git treat this file as binary.
 */
export function manifestRouteKey(
  manifest: Pick<SnapshotManifest, "provider" | "model">,
): string {
  return `${manifest.provider}\u0000${manifest.model}`;
}

export type { SessionRoute };
