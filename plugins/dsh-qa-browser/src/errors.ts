/**
 * Every refusal and failure the Browser runtime raises. The array is the one
 * source of truth: the union below, the Remote schema that carries a refusal
 * to the panel, and anything that later needs to enumerate the taxonomy all
 * read it, so a code can never exist in the type and be rejected on the wire.
 */
export const QA_BROWSER_ERROR_CODES = [
  "BROWSER_DISABLED",
  "BROWSER_START_FAILED",
  "BROWSER_CRASHED",
  "BROWSER_SESSION_NOT_FOUND",
  "BROWSER_CONTEXT_CLOSED",
  "BROWSER_TAB_NOT_FOUND",
  "BROWSER_TAB_CLOSED",
  "BROWSER_TOO_MANY_TABS",
  "BROWSER_NAVIGATION_BLOCKED",
  "BROWSER_SCHEME_BLOCKED",
  "BROWSER_HOST_BLOCKED",
  "BROWSER_REDIRECT_BLOCKED",
  "BROWSER_DSH_ORIGIN_BLOCKED",
  "BROWSER_TIMEOUT",
  "BROWSER_TARGET_NOT_FOUND",
  "BROWSER_TARGET_AMBIGUOUS",
  "BROWSER_STALE_REF",
  "BROWSER_HUMAN_CONTROL_DISABLED",
  "BROWSER_HUMAN_CONTROL_ACTIVE",
  "BROWSER_HUMAN_CONTROL_NOT_OWNER",
  "BROWSER_ACTION_FAILED",
] as const;

export type QaBrowserErrorCode = (typeof QA_BROWSER_ERROR_CODES)[number];

export class QaBrowserError extends Error {
  readonly name = "QaBrowserError";

  constructor(
    readonly code: QaBrowserErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function browserErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
