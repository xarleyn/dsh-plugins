import { IntegrationError, type IntegrationErrorCode } from "../errors.js";
import type { ServiceCredentialHealth } from "../service-credentials/types.js";
import type { IntegrationProviderId, StoredIntegration } from "../types.js";

/** What a probe verdict means for the stored binding, if anything. */
export function healthCode(
  health: ServiceCredentialHealth | undefined,
): IntegrationErrorCode | undefined {
  switch (health?.status) {
    case undefined:
    case "healthy":
      return undefined;
    case "expired":
      return "CredentialExpired";
    case "revoked":
      return "CredentialRevoked";
    case "unsafe_scope":
      return "ServiceCredentialUnsafeScope";
    default:
      return "ProviderUnavailable";
  }
}

/** Only a refused credential says the binding itself needs repair. */
const REFUSED_CREDENTIAL_CODES: readonly IntegrationErrorCode[] = Object.freeze(
  ["CredentialExpired", "CredentialRevoked", "InvalidCredential"],
);

export function refusedCredentialCode(
  error: unknown,
): IntegrationErrorCode | undefined {
  return error instanceof IntegrationError &&
    REFUSED_CREDENTIAL_CODES.includes(error.code)
    ? error.code
    : undefined;
}

/** Codes that mean policy refused the operation, wherever it was decided. */
const DENIAL_CODES: readonly IntegrationErrorCode[] = Object.freeze([
  "OperationDeniedByPolicy",
  "OperationNotAllowedWithServiceCredential",
  "SensitiveReadRequiresPersonalCredential",
  "ServiceResourceNotAllowed",
  "ServiceCredentialUnavailable",
  "ServiceCredentialDisabled",
  "ServiceCredentialInvalid",
  "PersonalCredentialRequired",
]);

export function isPolicyDenial(error: unknown): boolean {
  return error instanceof IntegrationError && DENIAL_CODES.includes(error.code);
}

/**
 * A deadline report reads only the budget the transport actually spent.
 * No upstream address, query, body or credential enters these log fields.
 */
export function transportTimeoutFields(
  provider: IntegrationProviderId,
  operation: string,
  error: unknown,
  serviceProfileId?: string | undefined,
) {
  if (
    !(error instanceof IntegrationError) ||
    error.code !== "UpstreamTimeout"
  ) {
    return undefined;
  }
  const budget = error.budget;
  return {
    provider,
    operation,
    ...(budget === undefined
      ? {}
      : {
          timeoutMs: budget.timeoutMs,
          retries: budget.retries,
          attempts: budget.attempts,
        }),
    ...(serviceProfileId === undefined
      ? {}
      : { serviceProfile: serviceProfileId }),
  };
}

/**
 * Describe the shape of the upstream refusal, never its content. A timeout
 * has its own report; an admission refusal has no upstream diagnostics.
 */
export function callFailureFields(
  provider: IntegrationProviderId,
  integration: Pick<StoredIntegration, "id" | "credentialSource">,
  operation: string,
  error: unknown,
  serviceProfileId?: string | undefined,
) {
  if (!(error instanceof IntegrationError)) return undefined;
  if (error.code === "UpstreamTimeout" || error.diagnostics === undefined) {
    return undefined;
  }
  const facts = error.diagnostics;
  return {
    provider,
    operation,
    reason: error.code,
    integrationId: integration.id,
    credentialSource: integration.credentialSource,
    ...(facts.status === undefined ? {} : { status: facts.status }),
    ...(facts.contentType === undefined
      ? {}
      : { contentType: facts.contentType }),
    ...(facts.errorClass === undefined ? {} : { errorClass: facts.errorClass }),
    ...(serviceProfileId === undefined
      ? {}
      : { serviceProfile: serviceProfileId }),
  };
}
