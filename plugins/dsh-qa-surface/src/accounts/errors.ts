/**
 * Coarse, wire-safe account failure codes. They ride the `(reason: <code>)`
 * marker pattern the attestation path established; the browser maps them to
 * audience-safe copy and the precise cause stays in the Host logs.
 */
export type QaAccountsErrorReason =
  | "auth-required"
  | "admin-required"
  | "invalid-credentials"
  | "account-disabled"
  | "email-taken"
  | "invalid-email"
  | "invalid-display-name"
  | "invalid-profile"
  | "profile-disabled"
  | "invalid-role"
  | "weak-password"
  | "registration-disabled"
  | "rate-limited"
  | "session-owned-elsewhere";

export class QaAccountsError extends Error {
  constructor(
    readonly reason: QaAccountsErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "QaAccountsError";
  }
}
