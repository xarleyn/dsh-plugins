import { QaAccountsError } from "./errors.js";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const MAX_DISPLAY_NAME_LENGTH = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** An account request after normalization, ready to become a stored user. */
export interface ValidatedCredentials {
  readonly email: string;
  /** Trimmed display name; empty means "derive one from the address". */
  readonly displayName: string;
}

/**
 * The length gate every path that sets a password goes through — registration,
 * the operator's addUser, and a reset — so a password good enough to register is
 * exactly the one an operator can put back.
 */
export function validatePassword(password: string): void {
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new QaAccountsError(
      "weak-password",
      `password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
}

/**
 * The email/password/display-name gate shared by self-registration and the
 * operator's addUser, so both paths reject unusable input with the same
 * errors and messages, in the same order. Returns the normalized address and
 * trimmed display name; the caller still decides uniqueness and role.
 */
export function validateCredentials(
  email: string,
  password: string,
  displayName: string | undefined,
): ValidatedCredentials {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 254) {
    throw new QaAccountsError("invalid-email", "email is not a usable address");
  }
  validatePassword(password);
  const name = (displayName ?? "").trim();
  if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new QaAccountsError(
      "invalid-display-name",
      `display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`,
    );
  }
  return { email: normalized, displayName: name };
}
