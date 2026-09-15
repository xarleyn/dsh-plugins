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
  | "ResultTooLarge";

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
