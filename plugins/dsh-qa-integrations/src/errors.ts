export type IntegrationErrorCode =
  | "IntegrationNotConnected"
  | "CredentialExpired"
  | "CredentialRevoked"
  | "ProviderPermissionDenied"
  | "ProviderUnavailable"
  | "OperationDeniedByPolicy"
  | "PrincipalNotResolved"
  | "InvalidCredential"
  | "InvalidRequest"
  /**
   * The resource does not exist, or the connected identity may not see it. Both
   * cases answer alike on purpose: the model must not learn from the error
   * whether some other account holds the resource.
   */
  | "ResourceNotFound"
  | "RateLimited"
  | "ResultTooLarge"
  /**
   * The upstream did not answer inside the provider timeout. Distinct from
   * `ProviderUnavailable` because it is worth retrying later as it is, while an
   * unreachable host usually needs an operator.
   */
  | "UpstreamTimeout"
  /**
   * The TLS handshake failed — an expired, self-signed or otherwise untrusted
   * certificate. The user cannot fix this from the connect form, so it is kept
   * apart from a plain unreachable host.
   */
  | "TlsFailure"
  /**
   * Managed service credentials. The first group describes the deployment's own
   * credential; the second describes what one user's binding may do with it.
   * The names follow the specification's `SERVICE_CREDENTIAL_*` /
   * `OPERATION_NOT_ALLOWED_*` codes in this package's casing convention, and
   * `publicIntegrationError` is what turns them into a client-visible reason.
   */
  | "ServiceCredentialUnavailable"
  | "ServiceCredentialDisabled"
  | "ServiceCredentialInvalid"
  | "ServiceCredentialUnsafeScope"
  | "ServiceResourceNotAllowed"
  | "OperationNotAllowedWithServiceCredential"
  | "SensitiveReadRequiresPersonalCredential"
  | "PersonalCredentialRequired";

/** Safe domain error: message and code never include upstream bodies or secrets. */
export class IntegrationError extends Error {
  constructor(
    readonly code: IntegrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "IntegrationError";
  }
}

export function publicIntegrationError(error: unknown): Error {
  const code =
    error instanceof IntegrationError ? error.code : "ProviderUnavailable";
  return new Error(`Integration request failed (reason: ${code})`);
}

/**
 * Whether a listing may pass over one resource instead of failing whole. A
 * resource that is missing, or that the connected identity may not see, is
 * worth reporting as unavailable: the caller asked for a set, and the rest of
 * it is still an answer. Any other failure is about the connection itself
 * (unreachable host, rejected credential) or the call itself, and must not be
 * swallowed by a loop over resources.
 */
export function recoverableResource(error: unknown): boolean {
  return (
    error instanceof IntegrationError &&
    (error.code === "ResourceNotFound" ||
      error.code === "ProviderPermissionDenied")
  );
}

/**
 * A configuration-loading failure. The scope names the configuration an
 * operator has to fix — "jira integration config", "qa-integrations managed
 * service credentials" — and is bound once per configuration module, so every
 * failure of that module reads alike and no message carries a secret value.
 */
export function scopedConfigError(scope: string): (message: string) => Error {
  return (message) => new Error(`${scope}: ${message}`);
}
