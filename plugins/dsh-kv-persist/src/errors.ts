/**
 * Error taxonomy for the kv-persist plugin (SPEC §79).
 *
 * Every failure carries a stable machine-readable `code`; messages are for
 * humans. Per the failure policy (SPEC §32) these errors normally degrade to
 * cold inference — only `strict: true` turns them into request failures.
 */

export type KvPersistErrorCode =
  | "KV_BACKEND_UNAVAILABLE"
  | "KV_BACKEND_UNSUPPORTED"
  | "KV_SLOT_NOT_FOUND"
  | "KV_SLOT_BUSY"
  | "KV_SLOT_STATE_INVALID"
  | "KV_SNAPSHOT_NOT_FOUND"
  | "KV_SNAPSHOT_INCOMPATIBLE"
  | "KV_SNAPSHOT_CORRUPT"
  | "KV_SAVE_FAILED"
  | "KV_RESTORE_FAILED"
  | "KV_ERASE_FAILED"
  | "KV_MANIFEST_INVALID"
  | "KV_METADATA_IO"
  | "KV_OPERATION_TIMEOUT"
  | "KV_INVARIANT";

/** Base class of every typed kv-persist error. */
export class KvPersistError extends Error {
  readonly code: KvPersistErrorCode;

  constructor(code: KvPersistErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The llama server or its slots endpoint cannot be reached. */
export class KvBackendUnavailableError extends KvPersistError {
  constructor(message: string, options?: ErrorOptions) {
    super("KV_BACKEND_UNAVAILABLE", message, options);
  }
}

/** The configured backend type does not expose the required slot surface. */
export class KvBackendUnsupportedError extends KvPersistError {
  constructor(message: string) {
    super("KV_BACKEND_UNSUPPORTED", message);
  }
}

/** A slot operation referenced a slot the server does not have. */
export class KvSlotNotFoundError extends KvPersistError {
  readonly slotId: number;

  constructor(slotId: number, message?: string) {
    super("KV_SLOT_NOT_FOUND", message ?? `slot ${slotId} not found on the server`);
    this.slotId = slotId;
  }
}

/** A slot is busy with another exclusive operation. */
export class KvSlotBusyError extends KvPersistError {
  readonly slotId: number;

  constructor(slotId: number, message?: string) {
    super("KV_SLOT_BUSY", message ?? `slot ${slotId} is busy`);
    this.slotId = slotId;
  }
}

/** The slot exists but its reported state cannot be used safely. */
export class KvSlotStateInvalidError extends KvPersistError {
  readonly slotId: number;

  constructor(slotId: number, message: string) {
    super("KV_SLOT_STATE_INVALID", message);
    this.slotId = slotId;
  }
}

/** The requested snapshot does not exist. */
export class KvSnapshotNotFoundError extends KvPersistError {
  constructor(message: string) {
    super("KV_SNAPSHOT_NOT_FOUND", message);
  }
}

/** A snapshot exists but its runtime identity is incompatible. */
export class KvSnapshotIncompatibleError extends KvPersistError {
  constructor(message: string) {
    super("KV_SNAPSHOT_INCOMPATIBLE", message);
  }
}

/** A snapshot exists but cannot be used (corrupt, truncated, failed restore). */
export class KvSnapshotCorruptError extends KvPersistError {
  constructor(message: string, options?: ErrorOptions) {
    super("KV_SNAPSHOT_CORRUPT", message, options);
  }
}

/** A save operation failed on the backend. */
export class KvSaveFailedError extends KvPersistError {
  constructor(message: string, options?: ErrorOptions) {
    super("KV_SAVE_FAILED", message, options);
  }
}

/** A restore operation failed on the backend. */
export class KvRestoreFailedError extends KvPersistError {
  constructor(message: string, options?: ErrorOptions) {
    super("KV_RESTORE_FAILED", message, options);
  }
}

/** An erase operation failed on the backend. */
export class KvEraseFailedError extends KvPersistError {
  constructor(message: string, options?: ErrorOptions) {
    super("KV_ERASE_FAILED", message, options);
  }
}

/** A snapshot manifest exists but fails schema validation. */
export class KvManifestInvalidError extends KvPersistError {
  constructor(message: string) {
    super("KV_MANIFEST_INVALID", message);
  }
}

/** Local metadata storage could not be read or written. */
export class KvMetadataIoError extends KvPersistError {
  constructor(message: string, options?: ErrorOptions) {
    super("KV_METADATA_IO", message, options);
  }
}

/** A persistence operation exceeded its own bounded timeout (SPEC §59). */
export class KvOperationTimeoutError extends KvPersistError {
  constructor(message: string, options?: ErrorOptions) {
    super("KV_OPERATION_TIMEOUT", message, options);
  }
}

/** An internal invariant was violated; always a plugin bug. */
export class KvInvariantError extends KvPersistError {
  constructor(message: string) {
    super("KV_INVARIANT", message);
  }
}

/**
 * Why a snapshot was invalidated (SPEC §31). Invalidation never deletes
 * binary data; it only flips manifest state so cleanup can happen later.
 */
export type SnapshotInvalidationReason =
  | "MODEL_FINGERPRINT_CHANGED"
  | "RESTORE_FAILED"
  | "MANIFEST_MALFORMED"
  | "SNAPSHOT_FILE_MISSING"
  | "EXPLICIT";
