import {
  serviceOperationAccess,
  type ServiceOperationSelection,
} from "../../service-credentials/operation-policy.js";
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
 * What the managed credential refuses by default, in the words a tool says before it
 * is called. The model reads this instead of discovering it in a refusal, so it
 * neither promises a user a log it cannot fetch nor goes looking for a fault in
 * the stand's own integration.
 */
export const SERVICE_CEILING_NOTICE =
  "By default this reading needs a personal connection. The administrator can permit it for a managed service profile; resource boundaries still apply.";

/**
 * Whether the ceiling refuses one operation *as a reading* — the case worth
 * warning about, because the deployment's capability switch stays on while the
 * answer stays personal. A write needs no warning: it is outside a read-only
 * credential whatever it returns. An operation the provider never classified is
 * refused too, and says so, because that is what the lock below will answer.
 */
export function serviceCeilingRefusedReading(
  security: OperationSecurityMetadata | undefined,
): boolean {
  if (security === undefined) return true;
  return (
    security.effect === "read" &&
    (security.sensitivity !== "normal" ||
      security.serviceCredential !== "allow")
  );
}

/**
 * Apply the catalog defaults and the trusted service profile's allow/deny rules.
 * The broker decides this first; this guard repeats the decision for callers
 * that reach a provider directly. An operation the provider does not classify
 * is denied, exactly as the broker's default is.
 */
export function assertServiceOperationAllowed(
  metadata: OperationSecurityMetadata | undefined,
  message: string,
  selection: ServiceOperationSelection = {},
): void {
  const security = metadata ?? UNCLASSIFIED_OPERATION;
  const access = serviceOperationAccess(security, selection);
  if (access === "allow") return;
  if (access === "policy")
    throw new IntegrationError(
      "OperationNotAllowedWithServiceCredential",
      `${message}: this reading is disabled by deployment policy`,
    );
  // The same order of reasons the broker answers with: a write is refused for
  // being a write; sensitive content requires a profile allowance or a personal
  // account.
  if (security.effect !== "read") {
    throw new IntegrationError(
      "OperationNotAllowedWithServiceCredential",
      `${message}: the service credential performs reads only`,
    );
  }
  if (security.sensitivity !== "normal") {
    throw new IntegrationError(
      "SensitiveReadRequiresPersonalCredential",
      `${message}: it can return text a build or another person produced, so a personal account is required`,
    );
  }
  throw new IntegrationError(
    "OperationNotAllowedWithServiceCredential",
    message,
  );
}
