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

/**
 * What a transport spent on the failure it handed back: the deadline one attempt
 * was held to, how many further attempts the deployment allows, and how many
 * attempts the call actually cost.
 *
 * The loop that made the attempts is the only party that knows these three, and
 * the party that reports the failure to the operator — the broker, which knows
 * the provider and the operation — has no view of them. So the loop writes them
 * on the error it gives up with and the report reads them off. Numbers only: a
 * budget names no address, no query, no body and no credential.
 */
export interface TransportBudget {
  /** The per-attempt deadline, in milliseconds. */
  readonly timeoutMs: number;
  /** Attempts the deployment allows after the first one. */
  readonly retries: number;
  /** Attempts spent, the first included. */
  readonly attempts: number;
}

/**
 * What an upstream answer looked like, as far as a log may say it: the shape of
 * the answer, never its content. A status, a media type and the class of a
 * transport failure are what tells an expired key from a host that is down —
 * and none of them is a body, an address or a credential.
 */
export interface TransportDiagnostics {
  /** Status of an answer that arrived; absent when nothing answered. */
  readonly status?: number;
  /** Media type the answer declared for itself. */
  readonly contentType?: string;
  /** Class of the failure the fetch itself raised, when nothing answered. */
  readonly errorClass?: string;
}

/** Safe domain error: message and code never include upstream bodies or secrets. */
export class IntegrationError extends Error {
  /**
   * Set by a transport on the failure it refused a call with; absent on every
   * error that never reached one.
   */
  budget?: TransportBudget;

  /**
   * Set by the transport that met the answer, on the failure it handed back.
   * The broker logs it, because the call that failed is the one an operator is
   * looking for and the party that decided the refusal no longer holds the
   * response.
   */
  diagnostics?: TransportDiagnostics;

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
