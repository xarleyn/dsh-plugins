export type QaBrowserErrorCode =
  | "BROWSER_DISABLED"
  | "BROWSER_START_FAILED"
  | "BROWSER_CRASHED"
  | "BROWSER_SESSION_NOT_FOUND"
  | "BROWSER_CONTEXT_CLOSED"
  | "BROWSER_TAB_NOT_FOUND"
  | "BROWSER_TAB_CLOSED"
  | "BROWSER_TOO_MANY_TABS"
  | "BROWSER_NAVIGATION_BLOCKED"
  | "BROWSER_SCHEME_BLOCKED"
  | "BROWSER_HOST_BLOCKED"
  | "BROWSER_REDIRECT_BLOCKED"
  | "BROWSER_DSH_ORIGIN_BLOCKED"
  | "BROWSER_TIMEOUT"
  | "BROWSER_ACTION_FAILED";

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
