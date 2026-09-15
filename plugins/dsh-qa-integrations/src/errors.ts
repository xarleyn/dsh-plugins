export type IntegrationErrorCode =
  | "IntegrationNotConnected"
  | "CredentialExpired"
  | "CredentialRevoked"
  | "ProviderPermissionDenied"
  | "ProviderUnavailable"
  | "OperationDeniedByPolicy"
  | "PrincipalNotResolved"
  | "InvalidCredential"
  | "InvalidRequest";

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
