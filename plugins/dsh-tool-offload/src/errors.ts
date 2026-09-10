/**
 * Typed plugin errors (guidelines §5.2).
 *
 * Config problems surface at load time as `OFFLOAD_INVALID_ARGUMENT`;
 * every runtime worker problem is contained by the fallback and only
 * reported through telemetry, never thrown across the DSH seam.
 */

export type OffloadErrorCode =
  | "OFFLOAD_INVALID_ARGUMENT"
  | "OFFLOAD_WORKER_UNAVAILABLE"
  | "OFFLOAD_WORKER_TIMEOUT"
  | "OFFLOAD_WORKER_FAILED"
  | "OFFLOAD_OUTPUT_REJECTED";

export class OffloadError extends Error {
  readonly code: OffloadErrorCode;

  constructor(code: OffloadErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OffloadError";
    this.code = code;
  }
}
