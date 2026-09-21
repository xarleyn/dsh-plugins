/**
 * Coarse, wire-safe account failure codes. They ride the `(reason: <code>)`
 * marker pattern the attestation path established; the browser maps them to
 * audience-safe copy and the precise cause stays in the Host logs.
 */
export type QaAccountsErrorReason =
  | "auth-required"
  | "admin-required"
  | "forbidden"
  | "invalid-credentials"
  /** The signed-in user typed a current password that does not match. */
  | "invalid-current-password"
  | "account-disabled"
  | "email-taken"
  | "invalid-email"
  | "invalid-display-name"
  | "invalid-profile"
  | "profile-disabled"
  | "invalid-starters"
  | "starters-disabled"
  /** The endpoint this credential is for is switched off on this deployment. */
  | "integration-disabled"
  | "invalid-role"
  | "weak-password"
  | "registration-disabled"
  | "rate-limited"
  | "session-owned-elsewhere"
  /** The conversation a deletion names is not one this deployment knows. */
  | "conversation-unknown"
  /** The Harness still holds the conversation open, so its log would come back. */
  | "conversation-live"
  /** This deployment cannot remove stored conversations at all. */
  | "conversation-not-removable";

export class QaAccountsError extends Error {
  constructor(
    readonly reason: QaAccountsErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "QaAccountsError";
  }
}
