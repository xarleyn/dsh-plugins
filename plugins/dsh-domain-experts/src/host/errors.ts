import type { DomainDegradationCode, DomainErrorCode } from "../types.js";

/** Typed domain failure. Every expected refusal carries a stable code. */
export class DomainExpertsError extends Error {
  readonly code: DomainErrorCode;
  /** Extra machine-readable detail; never holds secrets. */
  readonly refs: readonly string[];

  constructor(
    code: DomainErrorCode,
    message: string,
    options: {
      readonly refs?: readonly string[];
      readonly cause?: unknown;
    } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "DomainExpertsError";
    this.code = code;
    this.refs = options.refs ?? [];
  }
}

export function isDomainExpertsError(
  value: unknown,
): value is DomainExpertsError {
  return value instanceof DomainExpertsError;
}

/** Stable code of any thrown value; unexpected faults collapse to `INTERNAL`. */
export function errorCodeOf(error: unknown): string {
  return isDomainExpertsError(error) ? error.code : "INTERNAL";
}

/**
 * Message safe to show a user or return over the wire. The harness wraps a
 * cause chain for provider failures; the domain message is the actionable part.
 */
export function errorMessageOf(error: unknown): string {
  if (isDomainExpertsError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Map any thrown value onto a `HumanError`-shaped envelope field pair. */
export function failureEnvelope(error: unknown): {
  code: string;
  message: string;
} {
  return { code: errorCodeOf(error), message: errorMessageOf(error) };
}

/**
 * The subagent runtime refuses a composition request with its own code. The
 * plugin re-labels it so callers see the design's taxonomy while the original
 * provider message stays in `refs`.
 */
export const SUBAGENT_UNSUPPORTED_CODE = "UNSUPPORTED_CAPABILITY";

export function unsupportedCapability(
  provider: string,
  capability: string,
  detail: string,
): DomainExpertsError {
  return new DomainExpertsError(
    "UNSUPPORTED_SUBAGENT_CAPABILITY",
    `Subagent provider "${provider}" cannot supply the "${capability}" this expert requires: ${detail}`,
    { refs: [provider, capability] },
  );
}

export function degradation(
  code: DomainDegradationCode,
  message: string,
  refs: readonly string[],
): { code: DomainDegradationCode; message: string; refs: readonly string[] } {
  return { code, message, refs };
}
