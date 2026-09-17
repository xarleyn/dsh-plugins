import type { IntegrationErrorCode } from "../errors.js";
import type { IntegrationCapability } from "../types.js";
import type {
  OperationSecurityMetadata,
  ServiceCredentialProfile,
  ServiceResourceBoundary,
} from "./types.js";

/**
 * The service ceiling: an operation reaches a managed credential only when it
 * is a read, carries no more than normal sensitivity, and was classified as
 * service-safe on purpose. Upstream permissions are never part of this test:
 * a service token that happens to be able to trigger a build still cannot,
 * because the operation is a write.
 */
export const SERVICE_CEILING: OperationSecurityMetadata = Object.freeze({
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
});

export type ServicePolicyDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: IntegrationErrorCode;
      readonly message: string;
    };

const ALLOWED: ServicePolicyDecision = Object.freeze({ allowed: true });

function denied(
  code: IntegrationErrorCode,
  message: string,
): ServicePolicyDecision {
  return { allowed: false, code, message };
}

export interface ServiceOperationQuery {
  readonly metadata: OperationSecurityMetadata;
  /** Capability the operation belongs to, when its provider declares one. */
  readonly capability: IntegrationCapability | undefined;
  readonly profile: ServiceCredentialProfile;
  /** Resource kind the operation is scoped to, or undefined when it has none. */
  readonly boundaryKind: string | undefined;
}

/**
 * Decide one operation against the service ceiling and the administrator's
 * narrowing of it. The order of the checks is the order of the guarantees: an
 * operation is refused for being a write before it is refused for being
 * sensitive, so a caller can never widen the ceiling by re-classifying an
 * operation as sensitive.
 */
export function evaluateServiceOperation(
  query: ServiceOperationQuery,
): ServicePolicyDecision {
  const { metadata, capability, profile, boundaryKind } = query;
  if (metadata.effect !== "read") {
    return denied(
      "OperationNotAllowedWithServiceCredential",
      "Only read operations are available through the service credential",
    );
  }
  if (metadata.sensitivity !== "normal") {
    return denied(
      "SensitiveReadRequiresPersonalCredential",
      "This operation can return personal or otherwise sensitive data",
    );
  }
  if (metadata.serviceCredential !== "allow") {
    return denied(
      "OperationNotAllowedWithServiceCredential",
      "This operation is not enabled for the service credential",
    );
  }
  if (narrowed(profile, capability) !== undefined) {
    return denied(
      "OperationNotAllowedWithServiceCredential",
      "This operation is disabled for the service credential by deployment policy",
    );
  }
  if (metadata.requiresResourceBoundary === true) {
    if (boundaryKind === undefined) {
      // The provider did not say which boundary the operation reads; without
      // that there is no way to hold the call inside the boundary, so it fails
      // closed instead of reading the service account's whole upstream view.
      return denied(
        "ServiceResourceNotAllowed",
        "This operation is not scoped to a resource the service credential may read",
      );
    }
    const allowed = profile.resources[boundaryKind];
    if (allowed === undefined || allowed.length === 0) {
      return denied(
        "ServiceResourceNotAllowed",
        `The service credential does not bound ${boundaryKind}`,
      );
    }
  }
  return ALLOWED;
}

/** The policy key that narrows an operation, if the administrator set one. */
function narrowed(
  profile: ServiceCredentialProfile,
  capability: IntegrationCapability | undefined,
): string | undefined {
  const keys = Object.keys(profile.policy);
  if (keys.length === 0) return undefined;
  for (const key of keys) {
    if (capability !== undefined && key === capability) return key;
    if (key.startsWith(`${profile.provider}.`)) {
      const bare = key.slice(profile.provider.length + 1);
      if (capability !== undefined && bare === capability) return key;
    }
  }
  return undefined;
}

/** Exact membership of one identifier in one kind of a boundary. */
export function boundaryHas(
  boundary: ServiceResourceBoundary,
  kind: string,
  ref: string,
): boolean {
  return (boundary[kind] ?? []).includes(ref);
}

/**
 * Narrow a profile boundary by a user's own selection. A user may only remove:
 * anything not present in the profile boundary is dropped, so a forged
 * selection that named a resource outside the administrator's list can never
 * widen what the deployment allows.
 */
export function narrowBoundary(
  boundary: ServiceResourceBoundary,
  selection: ServiceResourceBoundary | undefined,
): ServiceResourceBoundary {
  if (selection === undefined) return boundary;
  const narrowed: Record<string, readonly string[]> = {};
  for (const [kind, allowed] of Object.entries(boundary)) {
    // Anything that is not a list of identifiers reads as "nothing narrowed": a
    // malformed selection can only fail to remove, never to add.
    const chosen = selection[kind];
    narrowed[kind] = Array.isArray(chosen)
      ? Object.freeze(allowed.filter((ref) => chosen.includes(ref)))
      : allowed;
  }
  return Object.freeze(narrowed);
}
