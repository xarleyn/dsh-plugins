/**
 * The one thing this plugin needs from the host's QA surface: which account a
 * session belongs to.
 *
 * Declared structurally rather than imported from `@yadsh/dsh-qa-surface` so
 * the plugin keeps working — and keeps typechecking — in a deployment that
 * installs no accounts surface at all. That is not a shortcut around a
 * dependency: an installation without accounts has exactly one memory space,
 * and the absence of the service *is* the answer to "per account or not".
 */
export interface QaPrincipalSurface {
  /** The account a chat root was attested by; never for a delegated child. */
  principalForSession(sessionId: string):
    | {
        readonly userId: string;
      }
    | undefined;
}

/**
 * The surface, when the value mounted under its id really answers for a
 * session. A deployment whose QA surface is absent, still starting, or without
 * that method reads as "no accounts here", which is what the plugin then acts
 * on instead of guessing at an owner.
 */
export function asQaPrincipalSurface(
  value: unknown,
): QaPrincipalSurface | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<QaPrincipalSurface>;
  return typeof candidate.principalForSession === "function"
    ? (candidate as QaPrincipalSurface)
    : undefined;
}
