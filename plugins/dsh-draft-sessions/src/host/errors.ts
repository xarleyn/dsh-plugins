export type DraftStoreErrorCode =
  | "DRAFT_NOT_FOUND"
  | "DRAFT_STALE_REVISION"
  | "DRAFT_LIMIT_REACHED"
  | "DRAFT_INVALID_INPUT"
  | "DRAFT_STORAGE_INVALID";

/** Stable domain failure raised by DraftStore and exposed by the Host service. */
export class DraftStoreError extends Error {
  constructor(
    message: string,
    public readonly code: DraftStoreErrorCode,
  ) {
    super(message);
    this.name = "DraftStoreError";
  }
}
