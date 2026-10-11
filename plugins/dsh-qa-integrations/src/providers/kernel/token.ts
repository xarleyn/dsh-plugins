import { IntegrationError } from "../../errors.js";

/**
 * The token policy shared by every provider: an encrypted payload names the
 * configured endpoint the secret belongs to and carries the secret itself. The
 * address is never stored — it is re-resolved from operator config on every
 * call, so removing or repointing an endpoint takes effect at once instead of
 * at the next connect. A credential minted for an endpoint the operator has
 * since removed fails closed: it never falls back to another endpoint, however
 * permissive that one is.
 */

/** The refusal every provider answers for a payload it cannot read. */
export function invalidStoredCredential(): never {
  throw new IntegrationError(
    "CredentialRevoked",
    "Stored credential is invalid",
  );
}

/**
 * `"text"` must be a string and may be empty (a deployment type that
 * authenticates on the token alone carries no account e-mail); `"nonempty"`
 * additionally refuses the empty value, which is how a secret that was never
 * entered reads.
 */
export type CredentialFieldRule = "text" | "nonempty";

/** Decode one credential payload field by field, refusing a half-shaped blob. */
export function decodeCredentialFields<
  S extends Readonly<Record<string, CredentialFieldRule>>,
>(plaintext: string, schema: S): { readonly [K in keyof S]: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    invalidStoredCredential();
  }
  if (typeof parsed !== "object" || parsed === null) {
    invalidStoredCredential();
  }
  const record = parsed as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [name, rule] of Object.entries(schema)) {
    const value = record[name];
    if (typeof value !== "string" || (rule === "nonempty" && value === "")) {
      invalidStoredCredential();
    }
    fields[name] = value;
  }
  return fields as { readonly [K in keyof S]: string };
}

/** The configured endpoint a credential names, or a fail-closed refusal. */
export function requireConfiguredEndpoint<T>(
  found: T | undefined,
  message: string,
): T {
  if (found === undefined) {
    throw new IntegrationError("CredentialRevoked", message);
  }
  return found;
}
