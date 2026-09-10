/**
 * Stable, coarse reason codes for QA policy attestation rejections.
 *
 * The RPC carrier folds a thrown Host error into `{ code, message, details }`
 * and always empties `details`, so the wire message is the only channel back
 * to the browser. The message therefore carries a `(reason: <code>)` marker:
 * coarse enough to reveal nothing about the deployment policy to the QA
 * audience, precise enough for an operator reading the browser console to
 * know which class of mismatch to look for in the Host logs.
 */
export type QaAttestationReason =
  | "agent-unavailable"
  | "workspace-unavailable"
  | "composition-mismatch"
  | "permission-preset"
  | "adoption-refused"
  | "unknown-tools"
  | "attestation-failed";

/** Host rejection whose wire message carries the coarse reason marker. */
export class QaAttestationError extends Error {
  constructor(
    readonly reason: QaAttestationReason,
    message: string,
  ) {
    super(message);
    this.name = "QaAttestationError";
  }
}
