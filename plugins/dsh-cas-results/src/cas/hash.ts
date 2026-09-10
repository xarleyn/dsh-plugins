/**
 * Content identity helpers (SPEC §10, §25).
 *
 * Identity is always SHA-256 over the logical (uncompressed) payload bytes.
 * Refs are validated strictly: `^sha256:[a-f0-9]{64}$`; no arbitrary strings
 * ever reach the filesystem path builder.
 */

import { createHash } from "node:crypto";

import { CasError } from "./errors.js";

export const CAS_REF_PATTERN = /^sha256:([a-f0-9]{64})$/;
export const CAS_HASH_PATTERN = /^[a-f0-9]{64}$/;

export function sha256Hex(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function formatCasRef(hash: string): string {
  return `sha256:${hash}`;
}

/** Parse a `sha256:<64 hex>` reference; returns the bare hash. */
export function parseCasRef(ref: string): string {
  const match = CAS_REF_PATTERN.exec(ref.trim());
  const hash = match?.[1];
  if (hash === undefined) {
    throw new CasError(
      "CAS_INVALID_REF",
      `invalid CAS reference: expected "sha256:<64 hex characters>", got ${JSON.stringify(
        ref.length > 80 ? `${ref.slice(0, 77)}...` : ref,
      )}`,
    );
  }
  return hash;
}

/** Validate an already-parsed hash shape; used by internal path building. */
export function assertValidHash(hash: string): string {
  if (!CAS_HASH_PATTERN.test(hash)) {
    throw new CasError("CAS_INVALID_REF", `invalid SHA-256 hash: ${JSON.stringify(hash)}`);
  }
  return hash;
}
