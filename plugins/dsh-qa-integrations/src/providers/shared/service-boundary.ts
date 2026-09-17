import { IntegrationError } from "../../errors.js";
import {
  UNCLASSIFIED_OPERATION,
  type OperationSecurityMetadata,
  type ServiceResourceBoundary,
} from "../../service-credentials/types.js";
import type { ProviderContext } from "../contract.js";

/**
 * The resource boundary of a call that runs on the deployment's managed
 * credential, or undefined for a personal one.
 *
 * Reaching service mode without a boundary means the broker had nothing to hand
 * over, and reading without a boundary is what the whole feature forbids — so a
 * supporting provider fails closed here instead of falling back to "no
 * boundary, no restriction".
 */
export function serviceBoundaryOf(
  context: ProviderContext,
): ServiceResourceBoundary | undefined {
  if (context.credentialSource !== "service") return undefined;
  const boundary = context.resourceBoundary;
  if (boundary === undefined || Object.keys(boundary).length === 0) {
    throw new IntegrationError(
      "ServiceResourceNotAllowed",
      "The service credential has no resource boundary for this call",
    );
  }
  return boundary;
}

/** One refusal shape, so every service-mode denial reads the same. */
export function serviceResourceDenied(): IntegrationError {
  return new IntegrationError(
    "ServiceResourceNotAllowed",
    "Service mode reads only the resources this workspace is allowed to see",
  );
}

/**
 * Refuse an operation the provider's own catalog does not mark as service-safe.
 * The broker decides this first and with the administrator's narrowing on top;
 * this guard is the second lock, so a caller that reaches a provider directly —
 * or a future bug in the broker — still cannot read a log through a shared
 * credential. An operation the provider does not classify is denied, exactly as
 * the broker's default is.
 */
export function assertServiceOperationAllowed(
  metadata: OperationSecurityMetadata | undefined,
  message: string,
): void {
  const security = metadata ?? UNCLASSIFIED_OPERATION;
  if (
    security.effect === "read" &&
    security.sensitivity === "normal" &&
    security.serviceCredential === "allow"
  ) {
    return;
  }
  throw new IntegrationError(
    security.sensitivity === "normal" && security.effect === "read"
      ? "OperationNotAllowedWithServiceCredential"
      : "SensitiveReadRequiresPersonalCredential",
    message,
  );
}
