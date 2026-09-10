/**
 * Domain errors of the CAS result store.
 *
 * All storage/transformation failures are funneled through `CasError` so the
 * DSH integration boundary can fail open (return the original tool result)
 * without swallowing unrelated programming errors.
 */

export type CasErrorCode =
  | "CAS_INVALID_REF"
  | "CAS_INVALID_ARGUMENT"
  | "CAS_OBJECT_MISSING"
  | "CAS_INTEGRITY_FAILED"
  | "CAS_STORE_IO";

export class CasError extends Error {
  readonly code: CasErrorCode;

  constructor(code: CasErrorCode, message: string) {
    super(message);
    this.name = "CasError";
    this.code = code;
  }
}
